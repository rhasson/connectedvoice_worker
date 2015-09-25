'use strict';

var _ = require('lodash');

class Node {
  constructor(content, root) {
    this.content = content || {};
    this.root = root || false;
    this.nodes = new Map();
  }

  isRoot() {
    return this.root;
  }

  addNode(id, node) {
    this.nodes.set(id, node);
  }

  getAllNodes() {
    let temp = [];
    for (let i of this.nodes.values()) temp.push(i);
    return temp;
  }

  hasNode(id) {
    return this.nodes.has(id);
  }

  setContent(content) {
    this.content = content;
  }

  appendNodeTo(to_id, id, node) {
    let n = this.nodes.get(to_id);
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
    this.tree = new Map();
    this.rootId = 0;
    this.currIndex = undefined;
  }

  setRoot(item) {
    this.tree.set(item[this.idKey], new Node(item, true));
    this.rootId = item[this.idKey];
  }

  addBranch(item) {
    //add a branch to the tree
    let root = this.tree.get(this.rootId);
    root.addNode(item[this.idKey], new Node(item));
  }

  addNodeToBranch(id, node) {
    //add a node to an existing branch
    let root = this.tree.get(this.rootId);

    let check = (branch, id) => {
      if (branch.hasNode(id)) {
        branch.appendNodeTo(id, node[this.idKey], new Node(node));
        return true;
      } else {
        let nodes = branch.getAllNodes()
        if (nodes.length > 0) nodes.forEach( (n) => check(n, id) );
        else return false;
      }
    }

    check(root, id);
  }

  findById(id) {
    id = id || this.rootId;
    for (let i of this.flatWalk()) {
      if (i.id === id) return i.node;
    }
  }

  findByHash(path, value) {
    let ret = [];

    for (let i of this.flatWalk()) {
      let val = _.get(i.node, path);
      if (val === value) ret.push(i.node);
    }

    return ret;
  }

  print(branch) {
    let tree = {};
    let arr = branch || this.tree;
    for (let a of arr.entries()) {
      let id = a.shift();
      let node = a.shift().get();

      node.nodes = this.print(node.nodes)
      tree[id] = node;
    }
    return tree;
  }

  //walks through tree and yield records in order, flattening the tree in the process
  * flatWalk(branch) {
    let arr = branch || this.tree;
    for (let a of arr.entries()) {
      let id = a.shift();
      let node = a.shift().get();
      yield {id: id, node: node.content, children: node.nodes.size};
      if (node.nodes.size > 0) yield *this.flatWalk(node.nodes)
    }
  }

  * walk(branch) {
    let arr = branch || this.tree;
    for (let a of arr.entries()) {
      let id = a.shift();
      let node = a.shift();
      yield {id: id, node: node};
    }
  }
}

module.exports = Tree;