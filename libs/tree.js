'use strict';

var _ = require('lodash');

class Node {
  constructor(content, root) {
    this.content = content || {};
    this.root = root || false;
    this.nodes = [];
  }

  isRoot() {
    return this.root;
  }

  addNode(id, node) {
    this.nodes['_' + id] = node;
  }

  getAllNodes() {
    return _.values(this.nodes);
  }

  hasNode(id) {
    return !!this.nodes['_' + id];
  }

  setContent(content) {
    this.content = content;
  }

  appendNodeTo(to_id, id, node) {
    let n = this.nodes['_' + to_id];
    n.addNode(id, node);
  }

  get() {
    return {
      root: this.root,
      content: this.content,
      nodes: this.nodes
    }
  }
}

class Tree {
  constructor(id_key) {
    this.idKey = id_key || 'index';
    this.tree = [];
    this.rootId = 0;
    this.currIndex = undefined;
  }

  setRoot(item) {
    this.tree['_' + item[this.idKey]] = new Node(item, true);
    this.rootId = item[this.idKey];
  }

  addBranch(item) {
    //add a branch to the tree
    let root = this.tree['_' + this.rootId];
    root.addNode(item[this.idKey], new Node(item));
  }

  addNodeToBranch(id, node) {
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

  findById(id, path) {
    let vals = _.valuesIn(this.tree);
    let ret;
    let self = this;
    let key = path || this.idKey;

    function find(branch) {
      let nodes = branch.getAllNodes();
      if (_.get(branch.content, key) === id) return ret = branch;
      for (let i=0; i < nodes.length; i++) {
        find(nodes[i]);
      }
    }

    for (let i=0; i < vals.length; i++) {
      find(vals[i]);
    }

    return ret;
  }

  findByHash(path, value) {
    return this.findById(value, path);
  }

  findChildrenOfByHash(path, value, nativeArray) {
    let nodes = this.findById(value, path).getAllNodes();
    if (nativeArray) {
      return nodes.map(n => { return n.content });
    } else return nodes;
  }

  * flatWalk(branch) {
    let arr = branch || this.tree;
    for (let a in arr) {
      let node = arr[a]
      yield {id: a, node: node.content, children: Object.keys(node.nodes).length};
      if (Object.keys(node.nodes).length > 0) yield *this.flatWalk(node.nodes)
    }
  }
}

module.exports = Tree;