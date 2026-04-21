"use strict";Object.defineProperty(exports, "__esModule", {value: true});// src/generateHTML.ts
var _core = require('@tiptap/core');
var _model = require('@tiptap/pm/model');

// src/getHTMLFromFragment.ts

function getHTMLFromFragment(doc, schema, options) {
  if (typeof window === "undefined") {
    throw new Error(
      "getHTMLFromFragment can only be used in a browser environment\nIf you want to use this in a Node environment, use the `@tiptap/html/server` import instead."
    );
  }
  if (options == null ? void 0 : options.document) {
    const wrap2 = options.document.createElement("div");
    _model.DOMSerializer.fromSchema(schema).serializeFragment(doc.content, { document: options.document }, wrap2);
    return wrap2.innerHTML;
  }
  const wrap = window.document.createElement("div");
  _model.DOMSerializer.fromSchema(schema).serializeFragment(
    doc.content,
    {
      document: window.document
    },
    wrap
  );
  return wrap.innerHTML;
}

// src/generateHTML.ts
function generateHTML(doc, extensions) {
  if (typeof window === "undefined") {
    throw new Error(
      "generateHTML can only be used in a browser environment\nIf you want to use this in a Node environment, use the `@tiptap/html/server` import instead."
    );
  }
  const schema = _core.getSchema.call(void 0, extensions);
  const contentNode = _model.Node.fromJSON(schema, doc);
  return getHTMLFromFragment(contentNode, schema);
}

// src/generateJSON.ts


function generateJSON(html, extensions, options) {
  if (typeof window === "undefined") {
    throw new Error(
      "generateJSON can only be used in a browser environment\nIf you want to use this in a Node environment, use the `@tiptap/html/server` import instead."
    );
  }
  const schema = _core.getSchema.call(void 0, extensions);
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  if (!doc) {
    throw new Error("Failed to parse HTML string");
  }
  return _model.DOMParser.fromSchema(schema).parse(doc.body, options).toJSON();
}



exports.generateHTML = generateHTML; exports.generateJSON = generateJSON;
//# sourceMappingURL=index.cjs.map