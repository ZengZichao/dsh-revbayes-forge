/**
 * Rev lexer. Produces source-positioned tokens for the permissive parser and
 * the static validator. Rev comments start with `#`; strings are double quoted.
 */

const TWO_CHAR_OPS = new Set(['<-', ':=', '<=', '>=', '==', '!=', '&&', '||', '++', '--', '|>', '+=', '-=', '*=', '/=', '%='])
const ONE_CHAR_OPS = new Set(['~', '=', '<', '>', '+', '-', '*', '/', '^', '!', ':', '%', '&', '|'])
const PUNCT = new Set(['(', ')', '[', ']', '{', '}', ',', ';', '.'])
const IDENT_START = /[A-Za-z_]/
const IDENT_PART = /[A-Za-z0-9_]/
const DIGIT = /[0-9]/

const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v'

function unescapeString(raw) {
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = raw[i + 1]
    if (next === undefined) break
    i += 1
    switch (next) {
      case 'n': out += '\n'; break
      case 't': out += '\t'; break
      case 'r': out += '\r'; break
      case '"': out += '"'; break
      case '\\': out += '\\'; break
      default: out += next; break
    }
  }
  return out
}

/**
 * Tokenize one Rev source string.
 * @param {string} source
 * @returns {{tokens: object[], errors: object[]}}
 */
export function tokenize(source) {
  const tokens = []
  const errors = []
  let i = 0
  let line = 1
  let column = 1

  const advance = (count = 1) => {
    for (let n = 0; n < count; n += 1) {
      if (source[i] === '\n') {
        line += 1
        column = 1
      } else {
        column += 1
      }
      i += 1
    }
  }

  const push = (token) => tokens.push(token)

  while (i < source.length) {
    const ch = source[i]

    if (ch === '\n') {
      push({ type: 'newline', value: '\n', line, column, endLine: line, endColumn: column + 1, start: i, end: i + 1 })
      advance()
      continue
    }
    if (isSpace(ch)) {
      advance()
      continue
    }
    if (ch === '#') {
      while (i < source.length && source[i] !== '\n') advance()
      continue
    }

    const start = i
    const startLine = line
    const startColumn = column

    if (ch === '"') {
      advance()
      let raw = ''
      let terminated = false
      while (i < source.length) {
        const c = source[i]
        if (c === '\\') {
          raw += c
          advance()
          if (i < source.length) {
            raw += source[i]
            advance()
          }
          continue
        }
        if (c === '"') {
          advance()
          terminated = true
          break
        }
        if (c === '\n') break
        raw += c
        advance()
      }
      if (!terminated) {
        errors.push({
          code: 'RB1002',
          severity: 'error',
          message: 'Unterminated string literal.',
          line: startLine,
          column: startColumn,
          endLine: line,
          endColumn: column,
          start,
          end: i,
        })
      }
      push({
        type: 'string',
        value: unescapeString(raw),
        raw: source.slice(start, i),
        terminated,
        line: startLine,
        column: startColumn,
        endLine: line,
        endColumn: column,
        start,
        end: i,
      })
      continue
    }

    if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(source[i + 1] ?? ''))) {
      let j = i
      while (j < source.length && DIGIT.test(source[j])) j += 1
      if (source[j] === '.') {
        j += 1
        while (j < source.length && DIGIT.test(source[j])) j += 1
      }
      if (source[j] === 'e' || source[j] === 'E') {
        let k = j + 1
        if (source[k] === '+' || source[k] === '-') k += 1
        if (DIGIT.test(source[k] ?? '')) {
          j = k
          while (j < source.length && DIGIT.test(source[j])) j += 1
        }
      }
      const raw = source.slice(i, j)
      advance(j - i)
      push({
        type: 'number',
        value: Number(raw),
        raw,
        line: startLine,
        column: startColumn,
        endLine: line,
        endColumn: column,
        start,
        end: i,
      })
      continue
    }

    if (IDENT_START.test(ch)) {
      let j = i + 1
      while (j < source.length && IDENT_PART.test(source[j])) j += 1
      const raw = source.slice(i, j)
      advance(j - i)
      push({
        type: 'ident',
        value: raw,
        line: startLine,
        column: startColumn,
        endLine: line,
        endColumn: column,
        start,
        end: i,
      })
      continue
    }

    const pair = source.slice(i, i + 2)
    if (TWO_CHAR_OPS.has(pair)) {
      advance(2)
      push({ type: 'op', value: pair, line: startLine, column: startColumn, endLine: line, endColumn: column, start, end: i })
      continue
    }
    if (ONE_CHAR_OPS.has(ch)) {
      advance()
      push({ type: 'op', value: ch, line: startLine, column: startColumn, endLine: line, endColumn: column, start, end: i })
      continue
    }
    if (PUNCT.has(ch)) {
      advance()
      push({ type: 'punct', value: ch, line: startLine, column: startColumn, endLine: line, endColumn: column, start, end: i })
      continue
    }

    advance()
    errors.push({
      code: 'RB1001',
      severity: 'error',
      message: `Unexpected character ${JSON.stringify(ch)}.`,
      line: startLine,
      column: startColumn,
      endLine: line,
      endColumn: column,
      start,
      end: i,
    })
  }

  const eofLine = line
  const eofColumn = column
  push({ type: 'eof', value: '', line: eofLine, column: eofColumn, endLine: eofLine, endColumn: eofColumn, start: i, end: i })
  return { tokens, errors }
}
