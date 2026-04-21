import { JSONContent, Extensions } from '@tiptap/core';
import { ParseOptions } from '@tiptap/pm/model';

/**
 * This function generates HTML from a ProseMirror JSON content object.
 *
 * @remarks **Important**: This function requires `happy-dom` to be installed in your project.
 * @param doc - The ProseMirror JSON content object.
 * @param extensions - The Tiptap extensions used to build the schema.
 * @returns The generated HTML string.
 * @example
 * ```js
 * const html = generateHTML(doc, extensions)
 * console.log(html)
 * ```
 */
declare function generateHTML(doc: JSONContent, extensions: Extensions): string;

/**
 * Generates a JSON object from the given HTML string and converts it into a Prosemirror node with content.
 * @remarks **Important**: This function requires `happy-dom` to be installed in your project.
 * @param {string} html - The HTML string to be converted into a Prosemirror node.
 * @param {Extensions} extensions - The extensions to be used for generating the schema.
 * @param {ParseOptions} options - The options to be supplied to the parser.
 * @returns {Promise<Record<string, any>>} - A promise with the generated JSON object.
 * @example
 * const html = '<p>Hello, world!</p>'
 * const extensions = [...]
 * const json = generateJSON(html, extensions)
 * console.log(json) // { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello, world!' }] }] }
 */
declare function generateJSON(html: string, extensions: Extensions, options?: ParseOptions): Record<string, any>;

export { generateHTML, generateJSON };
