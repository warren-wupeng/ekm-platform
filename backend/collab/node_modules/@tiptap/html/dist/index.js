// src/generateHTML.ts
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";

// src/getHTMLFromFragment.ts
import { DOMSerializer } from "@tiptap/pm/model";
function getHTMLFromFragment(doc, schema, options) {
  if (typeof window === "undefined") {
    throw new Error(
      "getHTMLFromFragment can only be used in a browser environment\nIf you want to use this in a Node environment, use the `@tiptap/html/server` import instead."
    );
  }
  if (options == null ? void 0 : options.document) {
    const wrap2 = options.document.createElement("div");
    DOMSerializer.fromSchema(schema).serializeFragment(doc.content, { document: options.document }, wrap2);
    return wrap2.innerHTML;
  }
  const wrap = window.document.createElement("div");
  DOMSerializer.fromSchema(schema).serializeFragment(
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
  const schema = getSchema(extensions);
  const contentNode = Node.fromJSON(schema, doc);
  return getHTMLFromFragment(contentNode, schema);
}

// src/generateJSON.ts
import { getSchema as getSchema2 } from "@tiptap/core";
import { DOMParser } from "@tiptap/pm/model";
function generateJSON(html, extensions, options) {
  if (typeof window === "undefined") {
    throw new Error(
      "generateJSON can only be used in a browser environment\nIf you want to use this in a Node environment, use the `@tiptap/html/server` import instead."
    );
  }
  const schema = getSchema2(extensions);
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  if (!doc) {
    throw new Error("Failed to parse HTML string");
  }
  return DOMParser.fromSchema(schema).parse(doc.body, options).toJSON();
}
export {
  generateHTML,
  generateJSON
};
//# sourceMappingURL=index.js.map