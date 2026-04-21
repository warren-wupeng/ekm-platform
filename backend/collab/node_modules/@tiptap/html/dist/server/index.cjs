"use strict";Object.defineProperty(exports, "__esModule", {value: true});// src/server/generateHTML.ts
var _core = require('@tiptap/core');
var _model = require('@tiptap/pm/model');

// src/server/getHTMLFromFragment.ts

var _happydom = require('happy-dom');
function getHTMLFromFragment(doc, schema, options) {
  if (options == null ? void 0 : options.document) {
    const wrap = options.document.createElement("div");
    _model.DOMSerializer.fromSchema(schema).serializeFragment(doc.content, { document: options.document }, wrap);
    return wrap.innerHTML;
  }
  const localWindow = new (0, _happydom.Window)({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
      disableComputedStyleRendering: true
    }
  });
  let result;
  try {
    const wrap = localWindow.document.createElement("div");
    _model.DOMSerializer.fromSchema(schema).serializeFragment(
      doc.content,
      {
        document: localWindow.document
      },
      wrap
    );
    result = wrap.innerHTML;
  } finally {
    localWindow.happyDOM.abort();
    localWindow.happyDOM.close();
  }
  return result;
}

// src/server/generateHTML.ts
function generateHTML(doc, extensions) {
  const isNode = typeof process !== "undefined" && process.versions != null && process.versions.node != null;
  if (!isNode) {
    throw new Error(
      "generateHTML can only be used in a Node environment\nIf you want to use this in a browser environment, use the `@tiptap/html` import instead."
    );
  }
  const schema = _core.getSchema.call(void 0, extensions);
  const contentNode = _model.Node.fromJSON(schema, doc);
  return getHTMLFromFragment(contentNode, schema);
}

// src/server/generateJSON.ts



function generateJSON(html, extensions, options) {
  const isNode = typeof process !== "undefined" && process.versions != null && process.versions.node != null;
  if (!isNode) {
    throw new Error(
      "generateJSON can only be used in a Node environment\nIf you want to use this in a browser environment, use the `@tiptap/html` import instead."
    );
  }
  const localWindow = new (0, _happydom.Window)({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
      disableComputedStyleRendering: true
    }
  });
  const localDOMParser = new localWindow.DOMParser();
  let result;
  try {
    const schema = _core.getSchema.call(void 0, extensions);
    let doc = null;
    const htmlString = `<!DOCTYPE html><html><body>${html}</body></html>`;
    doc = localDOMParser.parseFromString(htmlString, "text/html");
    if (!doc) {
      throw new Error("Failed to parse HTML string");
    }
    result = _model.DOMParser.fromSchema(schema).parse(doc.body, options).toJSON();
  } finally {
    localWindow.happyDOM.abort();
    localWindow.happyDOM.close();
  }
  return result;
}



exports.generateHTML = generateHTML; exports.generateJSON = generateJSON;
//# sourceMappingURL=index.cjs.map