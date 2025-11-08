// Prism.js polyfill/stub for headless mode

type NoOp = (...args: any[]) => any;

class Token {
  type: string;
  content: any;
  alias?: string | string[];

  constructor(type: string, content: any, alias?: string | string[]) {
    this.type = type;
    this.content = content;
    this.alias = alias;
  }

  toString() {
    return this.content;
  }
}

interface Grammar {
  [key: string]: any;
}

const hooks = {
  all: {} as { [key: string]: Array<NoOp> },

  add(name: string, callback: NoOp) {
    if (!this.all[name]) {
      this.all[name] = [];
    }
    this.all[name].push(callback);
  },

  run(name: string, env: any) {
    const callbacks = this.all[name];
    if (callbacks?.length) {
      for (const callback of callbacks) {
        try {
          callback(env);
        } catch (_) {
        }
      }
    }
  },
};

const util = {
  encode(tokens: any): any {
    if (tokens instanceof Token) {
      return new Token(tokens.type, this.encode(tokens.content), tokens.alias);
    } else if (Array.isArray(tokens)) {
      return tokens.map((token) => this.encode(token));
    } else if (typeof tokens === "string") {
      return tokens
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }
    return tokens;
  },

  type(obj: any): string {
    return Object.prototype.toString.call(obj).slice(8, -1);
  },

  objId(obj: any): string {
    if (!obj.__id) {
      obj.__id = ++util._idCounter;
    }
    return obj.__id;
  },

  _idCounter: 0,

  clone(obj: any, visited?: any): any {
    visited = visited || {};

    if (obj === null || typeof obj !== "object") {
      return obj;
    }

    if (visited[util.objId(obj)]) {
      return visited[util.objId(obj)];
    }

    let clone: any;
    if (Array.isArray(obj)) {
      clone = [];
      visited[util.objId(obj)] = clone;
      for (let i = 0; i < obj.length; i++) {
        clone[i] = util.clone(obj[i], visited);
      }
    } else {
      clone = {};
      visited[util.objId(obj)] = clone;
      for (const key in obj) {
        if (Object.hasOwn(obj, key)) {
          clone[key] = util.clone(obj[key], visited);
        }
      }
    }

    return clone;
  },
};

const languages = {
  plaintext: {},
  plain: {},
  txt: {},
  text: {},

  extend(id: string, redef: Grammar): Grammar {
    const lang = util.clone(languages[id] || {});
    for (const key in redef) {
      lang[key] = redef[key];
    }
    return lang;
  },

  insertBefore(
    inside: string,
    before: string,
    insert: Grammar,
    root?: any,
  ): Grammar {
    root = root || this;
    const grammar = root[inside] || {};
    const ret: Grammar = {};

    for (const token in grammar) {
      if (Object.hasOwn(grammar, token)) {
        if (token === before) {
          for (const newToken in insert) {
            if (Object.hasOwn(insert, newToken)) {
              ret[newToken] = insert[newToken];
            }
          }
        }
        ret[token] = grammar[token];
      }
    }

    const old = root[inside];
    root[inside] = ret;

    languages.DFS(languages, (key: string, value: any) => {
      if (value === old && key !== inside) {
        return ret;
      }
    });

    return ret;
  },

  DFS(o: any, callback: NoOp, type?: string, visited?: any): any {
    visited = visited || {};
    const objId = util.objId(o);

    if (visited[objId]) {
      return;
    }
    visited[objId] = true;

    for (const i in o) {
      if (Object.hasOwn(o, i)) {
        const result = callback.call(o, i, o[i], type || i);
        if (result) {
          o[i] = result;
        } else if (typeof o[i] === "object" && o[i] !== null) {
          languages.DFS(o[i], callback, null, visited);
        }
      }
    }
  },

  clone: util.clone,
};

const Prism = {
  manual: true,
  disableWorkerMessageHandler: true,

  util,
  languages,
  plugins: {},
  hooks,
  Token,
  highlight(text: string, _grammar?: Grammar, _language?: string): string {
    return text;
  },
  highlightAll(_async?: boolean, callback?: NoOp): void {
    // No-op in headless environment
    if (callback) {
      callback();
    }
  },

  highlightAllUnder(
    _container: any,
    _async?: boolean,
    callback?: NoOp,
  ): void {
    // No-op in headless environment
    if (callback) {
      callback();
    }
  },

  highlightElement(_element: any, _async?: boolean, callback?: NoOp): void {
    // No-op in headless environment
    if (callback) {
      callback();
    }
  },

  tokenize(text: string, _grammar: Grammar, _language?: string): any[] {
    return [text];
  },
};

// Set up the global Prism object before any modules load
if (typeof globalThis !== "undefined") {
  (globalThis as any).Prism = Prism;
}

// Export for module usage
export default Prism;
