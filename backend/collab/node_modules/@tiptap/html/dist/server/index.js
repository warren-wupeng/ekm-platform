// src/server/generateHTML.ts
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";

// src/server/getHTMLFromFragment.ts
import { DOMSerializer } from "@tiptap/pm/model";
import { Window } from "happy-dom";
function getHTMLFromFragment(doc, schema, options) {
  if (options == null ? void 0 : options.document) {
    const wrap = options.document.createElement("div");
    DOMSerializer.fromSchema(schema).serializeFragment(doc.content, { document: options.document }, wrap);
    return wrap.innerHTML;
  }
  const localWindow = new Window({
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
    DOMSerializer.fromSchema(schema).serializeFragment(
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
  const schema = getSchema(extensions);
  const contentNode = Node.fromJSON(schema, doc);
  return getHTMLFromFragment(contentNode, schema);
}

// src/server/generateJSON.ts
import { getSchema as getSchema2 } from "@tiptap/core";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import { Window as Window2 } from "happy-dom";
function generateJSON(html, extensions, options) {
  const isNode = typeof process !== "undefined" && process.versions != null && process.versions.node != null;
  if (!isNode) {
    throw new Error(
      "generateJSON can only be used in a Node environment\nIf you want to use this in a browser environment, use the `@tiptap/html` import instead."
    );
  }
  const localWindow = new Window2({
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
    const schema = getSchema2(extensions);
    let doc = null;
    const htmlString = `<!DOCTYPE html><html><body>${html}</body></html>`;
    doc = localDOMParser.parseFromString(htmlString, "text/html");
    if (!doc) {
      throw new Error("Failed to parse HTML string");
    }
    result = PMDOMParser.fromSchema(schema).parse(doc.body, options).toJSON();
  } finally {
    localWindow.happyDOM.abort();
    localWindow.happyDOM.close();
  }
  return result;
}
export {
  generateHTML,
  generateJSON
};
//# sourceMappingURL=index.js.map