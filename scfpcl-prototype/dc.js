/* Small template runtime for the SCFPCL prototype.
   Renders each screen from an HTML template plus a logic class, using React. */
(function () {
  'use strict';
  var h = React.createElement;
  var Fragment = React.Fragment;
  var registry = {};
  var hosts = {};
  var routes = {};

  var EVENTS = { onclick: 'onClick', onchange: 'onChange', onsubmit: 'onSubmit', oninput: 'onInput', onkeydown: 'onKeyDown', onblur: 'onBlur', onfocus: 'onFocus' };
  var ATTRS = { 'class': 'className', 'for': 'htmlFor', maxlength: 'maxLength', readonly: 'readOnly', inputmode: 'inputMode', autocomplete: 'autoComplete', tabindex: 'tabIndex', colspan: 'colSpan', rowspan: 'rowSpan' };
  var BOOL = { readOnly: 1, disabled: 1, checked: 1, required: 1, multiple: 1, selected: 1 };
  var WHOLE = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/;
  var HOLE = /\{\{\s*([^{}]+?)\s*\}\}/g;

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch, cb) {
    var cur = this.state || {};
    var next = typeof patch === 'function' ? patch(cur) : patch;
    this.state = Object.assign({}, cur, next);
    if (this.__host) this.__host.setState(function (s) { return { v: s.v + 1 }; }, cb);
  };
  DCLogic.prototype.forceUpdate = function () { if (this.__host) this.__host.forceUpdate(); };
  DCLogic.prototype.renderVals = function () { return {}; };

  function lookup(path, scopes) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var segs = path.split('.');
    var val;
    for (var i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i] != null && segs[0] in scopes[i]) { val = scopes[i][segs[0]]; break; }
    }
    for (var j = 1; j < segs.length && val != null; j++) val = val[segs[j]];
    return val;
  }

  function getter(text) {
    var m = WHOLE.exec(text);
    if (m) { var p = m[1]; return function (scopes) { return lookup(p, scopes); }; }
    if (text.indexOf('{{') < 0) return null;
    return function (scopes) {
      return text.replace(HOLE, function (_, p) { var v = lookup(p, scopes); return v == null ? '' : String(v); });
    };
  }

  function cssToObj(css) {
    var out = {}, depth = 0, start = 0, parts = [];
    for (var i = 0; i < css.length; i++) {
      var c = css[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ';' && depth === 0) { parts.push(css.slice(start, i)); start = i + 1; }
    }
    parts.push(css.slice(start));
    parts.forEach(function (part) {
      var k = part.indexOf(':');
      if (k < 0) return;
      var name = part.slice(0, k).trim();
      var value = part.slice(k + 1).trim();
      if (!name || !value) return;
      if (name.indexOf('--') !== 0) name = name.replace(/-([a-z])/g, function (_, ch) { return ch.toUpperCase(); });
      out[name] = value;
    });
    return out;
  }

  function route(href) {
    var m = typeof href === 'string' && /^\/?([A-Za-z0-9_]+)\.dc\.html$/.exec(href);
    return m && routes[m[1]] ? routes[m[1]] : href;
  }

  function compileNodes(nodes) {
    var fns = [];
    for (var i = 0; i < nodes.length; i++) { var f = compileNode(nodes[i]); if (f) fns.push(f); }
    return function (scopes) {
      var out = [];
      for (var k = 0; k < fns.length; k++) { var r = fns[k](scopes, k); if (r !== null && r !== undefined && r !== false) out.push(r); }
      return out;
    };
  }

  function compileNode(node) {
    if (node.nodeType === 3) {
      var text = node.nodeValue;
      if (!/\S/.test(text) && text.indexOf('\n') >= 0) return null;
      var g = getter(text);
      if (!g) return function () { return text; };
      return function (scopes) { var v = g(scopes); return v == null || typeof v === 'boolean' ? '' : String(v); };
    }
    if (node.nodeType !== 1) return null;
    var tag = node.localName;
    if (tag === 'helmet') return null;

    if (tag === 'sc-if') {
      var cond = getter(node.getAttribute('value') || '');
      var kids = compileNodes(node.childNodes);
      return function (scopes, key) { return cond && cond(scopes) ? h.apply(null, [Fragment, { key: key }].concat(kids(scopes))) : null; };
    }
    if (tag === 'sc-for') {
      var listGet = getter(node.getAttribute('list') || '');
      var as = node.getAttribute('as') || 'item';
      var body = compileNodes(node.childNodes);
      return function (scopes, key) {
        var list = (listGet && listGet(scopes)) || [];
        var items = list.map(function (item, i) {
          var sc = { $index: i }; sc[as] = item;
          return h.apply(null, [Fragment, { key: i }].concat(body(scopes.concat([sc]))));
        });
        return h.apply(null, [Fragment, { key: key }].concat(items));
      };
    }
    if (tag === 'dc-import') {
      var name = node.getAttribute('name');
      var propGetters = [];
      var hostStyle = null;
      Array.prototype.forEach.call(node.attributes, function (a) {
        if (a.name === 'name' || a.name.indexOf('hint-') === 0) return;
        if (a.name === 'style') { hostStyle = cssToObj(a.value); return; }
        var prop = a.name.replace(/-([a-z])/g, function (_, ch) { return ch.toUpperCase(); });
        var pg = getter(a.value);
        propGetters.push([prop, pg, a.value]);
      });
      return function (scopes, key) {
        var props = { key: key, __hostStyle: hostStyle };
        propGetters.forEach(function (p) { props[p[0]] = p[1] ? p[1](scopes) : p[2]; });
        return h(getHost(name), props);
      };
    }

    var consts = {};
    var dyn = [];
    Array.prototype.forEach.call(node.attributes, function (a) {
      var n = a.name;
      if (n.indexOf('hint-') === 0) return;
      var prop = EVENTS[n] || ATTRS[n] || n;
      var g = getter(a.value);
      if (n === 'style') {
        if (g) dyn.push([prop, g]); else consts.style = cssToObj(a.value);
        return;
      }
      if (g) { dyn.push([prop, g]); return; }
      consts[prop] = BOOL[prop] ? true : prop === 'href' ? route(a.value) : a.value;
    });
    var children = compileNodes(node.childNodes);
    return function (scopes, key) {
      var props = Object.assign({ key: key }, consts);
      for (var i = 0; i < dyn.length; i++) {
        var v = dyn[i][1](scopes);
        var p = dyn[i][0];
        if (p === 'href') v = route(v);
        if (p === 'value' && v == null) v = '';
        props[p] = v;
      }
      return h.apply(null, [tag, props].concat(children(scopes)));
    };
  }

  function getHost(name) {
    if (hosts[name]) return hosts[name];
    var def = registry[name];
    if (!def) throw new Error('Unknown screen: ' + name);
    function Host(props) {
      React.Component.call(this, props);
      this.logic = new def.Logic(userProps(props));
      this.logic.__host = this;
      this.state = { v: 0 };
    }
    Host.prototype = Object.create(React.Component.prototype);
    Host.prototype.constructor = Host;
    Host.prototype.render = function () {
      if (!def.render) {
        var t = document.createElement('template');
        t.innerHTML = def.html;
        def.render = compileNodes(t.content.childNodes);
      }
      this.logic.props = userProps(this.props);
      var vals = this.logic.renderVals() || {};
      return h.apply(null, ['div', { className: 'sc-host', style: this.props.__hostStyle || undefined, 'data-screen': name }].concat(def.render([vals])));
    };
    hosts[name] = Host;
    return Host;
  }

  function userProps(props) {
    var out = {};
    Object.keys(props || {}).forEach(function (k) { if (k !== '__hostStyle') out[k] = props[k]; });
    return out;
  }

  window.DCLogic = DCLogic;
  window.DC = {
    register: function (name, html, Logic) { registry[name] = { html: html, Logic: Logic }; },
    routes: function (map) { routes = map; },
    mount: function (name, el) { ReactDOM.createRoot(el).render(h(getHost(name))); },
  };
})();
