/* @flow */

'use strict';

var _ = require('lodash');

class Node {

  /*:: content: Object;*/
  /*:: root: boolean;*/
  /*:: nodes: any;*/

  constructor(content, root) {
    this.content = content || {};
    this.root = root || false;
    this.nodes = [];
  }

  isRoot() /*: boolean*/{
    return this.root;
  }

  addNode(id/*: string*/, node/*: Object*/) {
    this.nodes['_' + id] = node;
  }

  getAllNodes() /*: Object*/{
    return _.values(this.nodes);
  }

  hasNode(id/*: string*/) /*: boolean*/ {
    return !!this.nodes['_' + id];
  }

  setContent(content/*: Object*/) {
    this.content = content;
  }

  appendNodeTo(to_id/*: string*/, id/*: string*/, node/*: Object*/) {
    let n = this.nodes['_' + to_id];
    n.addNode(id, node);
  }

  get() /*: Object*/ {
    return {
      root: this.root,
      content: this.content,
      nodes: this.nodes
    }
  }
}

class Tree {

  /*:: idKey: string;*/
  /*:: tree: Array<Object>;*/
  /*:: rootId: number;*/
  /*:: currIndex: number;*/

  constructor(id_key/*: string*/) {
    this.idKey = id_key || 'index';
    this.tree = [];
    this.rootId = 0;
    this.currIndex = 0;
  }

  setRoot(item/*: Object*/) {
    this.tree['_' + item[this.idKey]] = new Node(item, true);
    this.rootId = item[this.idKey];
  }

  addBranch(item/*: Object*/) {
    //add a branch to the tree
    let root = this.tree['_' + this.rootId];
    root.addNode(item[this.idKey], new Node(item));
  }

  addNodeToBranch(id/*: number*/, node/*: Object*/) {
    //add a node to an existing branch
    let root = this.tree['_' + this.rootId];

    let check = (id, branch) => {
      //console.log('BRANCH: ', branch)
      if (id === branch.content[this.idKey]) {
        branch.addNode(node[this.idKey], new Node(node));
      } else if (branch.hasNode(id)) {
        branch.appendNodeTo(id, node[this.idKey], new Node(node));
      } else {
        let nodes = branch.getAllNodes()
        if (nodes.length > 0) nodes.forEach( (n) => check(id, n) ); //was originally (n, id )
      }
    }

    check(id, root);
  }

  findById(path/*: string*/, value/*: any*/) /*: any*/ {
    let vals = _.valuesIn(this.tree);
    let ret;
    let self = this;
    let key = path || this.idKey;

    function find(branch/*:Object*/) /*: any*/{
      let nodes = branch.getAllNodes();
      if (_.get(branch.content, key) === value) {
        ret = branch;
        return;
      }
      for (let i=0; i < nodes.length; i++) {
        find(nodes[i]);
      }
    }

    for (let i=0; i < vals.length; i++) {
      find(vals[i]);
    }

    return ret;
  }

  findByHash(path/*: string*/, value/*: any*/) /*: Object*/ {
    return this.findById(path, value);
  }

  findChildrenOfByHash(path/*: string*/, value/*: any*/, nativeArray/*: boolean*/) /*: Array<Object>*/ {
    let node = this.findById(path, value);
    let nodes = (node != undefined) ? node.getAllNodes() : [];

    if (nativeArray && nodes.length > 0) {
      return nodes.map(n => { return n.content });
    } else return nodes;
  }

  * flatWalk(branch/*: Object*/) /*: any*/{
    let arr = branch || this.tree;
    for (let a in arr) {
      let node = arr[a]
      yield {id: a, node: node.content, children: Object.keys(node.nodes).length};
      if (Object.keys(node.nodes).length > 0) yield *this.flatWalk(node.nodes)
    }
  }
}

module.exports = Tree;