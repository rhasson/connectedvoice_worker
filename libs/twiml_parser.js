'use strict';

var _ = require('lodash');
var config = require('../config.json');
var Tree = require('./tree.js');


class Parser {
  /* id_key: {string} name of key in parsed object to be used as an ID.
  * ID will be used as key in the Tree to lookup ivr elements
  */
  constructor(id_key) {
    this.currPos = 0;
    this.list = [];
    this.tree;
    this.idKey = id_key || 'index';
  }

  create(records) {
    this.currPos = 0;
    //iterate over ivr records parsing each and returning array of ivrs
    for (let item in records) {
      this.parse(records[item]);
    }
    //iterate over parsed array of ivrs and build tree
    this.tree = this.buildTree(this.list);
    return this;
  }

  parse(action) {
    let ret;
    let self = this;

    let push = () => {
      self.list.push({
        id: self.currPos,
        next: self.currPos + 1,
        prev: self.currPos === 0 ? undefined : self.currPos - 1,
        content: action
      });
      self.currPos++;
    }

    if (!('actions' in action) && !('nested' in action)) {
      push();
    } else if ('actions' in action) {
      push();
      for (let i in action.actions) {
        this.parse(action.actions[i]);
      }
    } else if ('nested' in action) {
      push();
      for (let i in action.nested) {
        this.parse(action.nested[i]);
      }
    }
  }

  buildTree(list) {
    let tree = new Tree(this.idKey);

      for (var i of list) {
        let item = i.content;
        if (i.prev === undefined && !('parent_id' in item) /* && !('action_for' in item) */) {
          tree.setRoot(item);
        } else if (!('parent_id' in item) && !('action_for' in item)) {
          tree.addBranch(item);
        } else if ('parent_id' in item) {
          tree.addNodeToBranch(item.parent_id, item);
        } else if ('action_for' in item) {
          tree.addNodeToBranch(item.action_for, item);
        }
      }

      return tree;
  }

  buildTwiml(twimlResponse, params, userid) {
    if (!('legalNodes' in twimlResponse) || !('say' in twimlResponse)) return new Error ('Not a valid TwiML object');
    let it = this.tree.flatWalk();
    let obj = it.next();

    while (!obj.done) {
      create(twimlResponse, obj.value);
    }


    function create(twiml, node) {
      let tmpl = undefined;
      let item = node.node;
      try {
        switch (item.verb) {
          case 'say':
            tmpl = _.template(item.nouns.text);
            twiml.say(tmpl(params), item.verb_attributes);
            break;
          case 'dial':
            item.verb_attributes.method = "POST"
            item.verb_attributes.action = config.callbacks.ActionUrl.replace('%userid', userid);
            item.verb_attributes.action += '/' + item.index;
            twiml.dial(item.verb_attributes, function(child) {
              if ('number' in item.nouns) {
                for (var j=0; j < item.nouns.number.length; j++) {
                  child.number(item.nouns.number[j]);  
                }
              } else child.text = item.nouns.text;
            });
            break;
          case 'hangup':
            twiml.hangup();
            break;
          case 'gather':
            item.verb_attributes.method = "POST";
            item.verb_attributes.action = config.callbacks.ActionUrl.replace('%userid', userid);
            item.verb_attributes.action += '/' + item.index;
            console.log('GATHER: ', item)
            twiml.gather(item.verb_attributes, function(child) {
              for (let i=0; i < node.children; i++) {
                obj = it.next();
                create(child, obj.value);
              }
            });
            break;
          case 'pause':
            twiml.pause(item.verb_attributes);
            break;
          case 'reject':
            twiml.pause(item.verb_attributes);
            break;
          case 'message':
            item.verb_attributes.method = 'POST';
            item.verb_attributes.action = config.callbacks.ActionUrl.replace('%userid', userid);
            item.verb_attributes.action += '/' + item.index;
            item.verb_attributes.statusCallback = config.callbacks.StatusCallback.replace('%userid', userid);
            tmpl = _.template(item.nouns.body);
            twiml.sms(tmpl(params), item.verb_attributes);
            break;
        }
        return obj = it.next();
      } catch(e) {
        console.log(e)
        return obj = it.next();
      }
    }
    return twimlResponse;
  }

  find(id, val) {
    if (arguments.length === 1) return this.tree.findById(id);
    else if (arguments.length === 2) return this.tree.findByHash(id, val);
    else return new Error('Invalid number of arguments');
  }

  toJSON() {
    return this.tree.print();
  }
}


module.exports = Parser;


/* Usage:
let p = new Parser();
let twiml = p.create(ivrs).buildTwiml(Twilio.TwimlResponse());
let j = JSON.stringify(p.create(ivrs));

twiml.toString();

//finds a record by the branch id
p.find("1436988415019");

//find a record by that matches the key and value
p.find('verb', 'dial');
*/