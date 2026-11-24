// BERT 中文 WordPiece 分词器：读 HF tokenizer.json 的 vocab，离线实现，不依赖 transformers.js。
// 规则与 bert-base-chinese 一致：小写化、中文逐字加空格、标点独立、子词 ## 续接、[CLS]/[SEP] 包裹。
const CJK = /[㐀-䶿一-鿿豈-﫿]/;
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

function isPunct(ch) {
  const c = ch.codePointAt(0);
  if ((c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126)) return true;
  return /\p{P}|\p{S}/u.test(ch);
}

function clean(text, lowerCase) {
  let t = String(text).replace(CONTROL, '');
  if (lowerCase) t = t.toLowerCase();
  let out = '';
  for (const ch of t) {
    if (CJK.test(ch)) out += ` ${ch} `;
    else if (isPunct(ch)) out += ` ${ch} `;
    else out += ch;
  }
  return out;
}

function wordpiece(word, vocab, unk) {
  if (vocab.has(word)) return [word];
  if (word.length > 100) return [unk];
  const parts = [];
  let start = 0;
  while (start < word.length) {
    let end = word.length;
    let found = null;
    while (start < end) {
      const sub = (start > 0 ? '##' : '') + word.slice(start, end);
      if (vocab.has(sub)) { found = sub; break; }
      end--;
    }
    if (found === null) return [unk];
    parts.push(found);
    start = end;
  }
  return parts;
}

export function createTokenizer(tokenizerJson, { lowerCase = true, maxLength = 512 } = {}) {
  const vocabMap = tokenizerJson?.model?.vocab ?? {};
  const vocab = new Map(Object.entries(vocabMap));
  const added = new Map((tokenizerJson?.added_tokens ?? []).map((t) => [t.content, t.id]));
  const idOf = (t) => added.get(t) ?? vocab.get(t);
  const CLS = idOf('[CLS]') ?? 101;
  const SEP = idOf('[SEP]') ?? 102;
  const UNK = idOf('[UNK]') ?? 100;
  const unkToken = vocab.has('[UNK]') ? '[UNK]' : [...vocab.keys()].find((k) => vocab.get(k) === UNK) ?? '[UNK]';

  function tokenize(text) {
    const tokens = [];
    for (const word of clean(text, lowerCase).split(/\s+/).filter(Boolean)) {
      tokens.push(...wordpiece(word, vocab, unkToken));
    }
    return tokens;
  }

  function encode(text) {
    const tokens = tokenize(text).slice(0, maxLength - 2);
    const ids = [CLS, ...tokens.map((t) => vocab.get(t) ?? UNK), SEP];
    return {
      ids,
      mask: ids.map(() => 1),
      types: ids.map(() => 0),
    };
  }

  return { tokenize, encode, vocabSize: vocab.size, ids: { CLS, SEP, UNK } };
}