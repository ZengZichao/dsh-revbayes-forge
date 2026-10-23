/**
 * Permissive Rev parser.
 *
 * Rev has no published grammar in this repository, so the parser accepts the
 * constructs used by RevBayes tutorials and tests: statements, assignments
 * (`<-`, `:=`, `~`, `=`), calls with positional and named arguments, member
 * and index access, vectors, for/while/if, and function literals. It is
 * deliberately forgiving: malformed regions become error diagnostics while the
 * rest of the file is still parsed, so one typo does not hide the others.
 */
import { tokenize } from './lexer.js'

const PRECEDENCE = new Map([
  ['|>', 0],
  ['||', 1],
  ['&&', 2],
  ['|', 3],
  ['&', 4],
  ['==', 5],
  ['!=', 5],
  ['<', 6],
  ['>', 6],
  ['<=', 6],
  ['>=', 6],
  [':', 7],
  ['+', 8],
  ['-', 8],
  ['*', 9],
  ['/', 9],
  ['%', 9],
  ['^', 10],
])
const RIGHT_ASSOC = new Set(['^'])
const ASSIGN_OPS = new Set(['<-', ':=', '~', '=', '+=', '-=', '*=', '/=', '%='])
const KEYWORDS = new Set(['for', 'while', 'if', 'else', 'in', 'function', 'return'])

class Parser {
  constructor(tokens) {
    this.tokens = tokens
    this.pos = 0
    this.nesting = 0
    this.errors = []
  }

  get current() {
    return this.tokens[this.pos]
  }

  peek(offset = 0) {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]
  }

  next() {
    const token = this.current
    if (token.type !== 'eof') this.pos += 1
    return token
  }

  is(value, type = null) {
    const token = this.current
    return (type === null || token.type === type) && token.value === value
  }

  isType(type) {
    return this.current.type === type
  }

  error(code, message, token = this.current, suggestion = null) {
    this.errors.push({
      code,
      severity: 'error',
      message,
      line: token.line,
      column: token.column,
      endLine: token.endLine,
      endColumn: token.endColumn,
      start: token.start,
      end: token.end,
      ...(suggestion === null ? {} : { suggestion }),
    })
  }

  skipNewlines() {
    while (this.current.type === 'newline') this.next()
  }

  /** Newlines are insignificant while inside parentheses or brackets. */
  skipSoft() {
    if (this.nesting > 0) this.skipNewlines()
  }

  skipSeparators() {
    while (this.current.type === 'newline' || this.is(';')) this.next()
  }

  atStatementEnd() {
    const token = this.current
    return token.type === 'newline'
      || token.type === 'eof'
      || token.value === ';'
      || token.value === '}'
  }

  parseProgram(stopAtBrace = false) {
    const body = []
    while (!this.isType('eof')) {
      this.skipSeparators()
      if (this.isType('eof')) break
      if (stopAtBrace && this.is('}')) break
      if (this.is('}')) {
        this.error('RB1102', 'Unexpected closing brace.', this.current)
        this.next()
        continue
      }
      const before = this.pos
      const statement = this.parseStatement()
      if (statement !== null) body.push(statement)
      if (this.pos === before) {
        this.error('RB1103', `Could not parse ${JSON.stringify(this.current.value)}.`, this.current)
        this.next()
        continue
      }
      this.skipSoft()
      if (!this.atStatementEnd()) {
        this.error(
          'RB1101',
          `Unexpected ${JSON.stringify(this.current.value)} after statement; expected end of line, ';', or '}'.`,
          this.current,
        )
        while (!this.atStatementEnd()) this.next()
      }
    }
    const first = body[0]
    const last = body.at(-1)
    return {
      type: 'program',
      body,
      start: first?.start ?? 0,
      end: last?.end ?? 0,
      line: first?.line ?? 1,
      endLine: last?.endLine ?? 1,
    }
  }

  parseStatement() {
    this.skipSeparators()
    const token = this.current
    if (token.type === 'ident') {
      if (token.value === 'for') return this.parseFor()
      if (token.value === 'while') return this.parseWhile()
      if (token.value === 'if') return this.parseIf()
      if (token.value === 'return') {
        this.next()
        const value = this.atStatementEnd() ? null : this.parseExpression()
        return { type: 'return', value, start: token.start, end: value?.end ?? token.end, line: token.line, endLine: value?.endLine ?? token.endLine }
      }
      if (token.value === 'function' && this.peek(1).value !== '(') {
        return this.parseFunctionDeclaration()
      }
    }
    if (this.is('{')) return this.parseBlock()
    return this.parseAssignmentOrExpression()
  }

  parseAssignmentOrExpression() {
    const startToken = this.current
    const target = this.parseExpression()
    const opToken = this.current
    if (opToken.type === 'op' && ASSIGN_OPS.has(opToken.value)) {
      this.next()
      this.skipSoft()
      const value = this.parseExpression()
      return {
        type: 'assign',
        operator: opToken.value,
        target,
        value,
        start: startToken.start,
        end: value?.end ?? opToken.end,
        line: startToken.line,
        endLine: value?.endLine ?? opToken.endLine,
      }
    }
    return {
      type: 'expr',
      expression: target,
      start: startToken.start,
      end: target?.end ?? startToken.end,
      line: startToken.line,
      endLine: target?.endLine ?? startToken.endLine,
    }
  }

  parseFor() {
    const start = this.next()
    this.skipSoft()
    if (!this.is('(')) this.error('RB1110', "Expected '(' after 'for'.", this.current)
    else this.next()
    this.nesting += 1
    this.skipSoft()
    const variable = this.current.type === 'ident' ? this.next() : null
    if (variable === null) this.error('RB1111', "Expected a loop variable in 'for'.", this.current)
    this.skipSoft()
    if (this.is('in')) this.next()
    else this.error('RB1112', "Expected 'in' in the for loop header.", this.current)
    this.skipSoft()
    const iterable = this.parseExpression()
    this.skipSoft()
    if (this.is(')')) this.next()
    else this.error('RB1113', "Expected ')' to close the for loop header.", this.current)
    this.nesting -= 1
    this.skipNewlines()
    const body = this.parseBlockOrStatement()
    return {
      type: 'for',
      variable: variable?.value ?? null,
      variableToken: variable,
      iterable,
      body,
      start: start.start,
      end: body?.end ?? iterable?.end ?? start.end,
      line: start.line,
      endLine: body?.endLine ?? iterable?.endLine ?? start.endLine,
    }
  }

  parseWhile() {
    const start = this.next()
    this.skipSoft()
    if (!this.is('(')) this.error('RB1120', "Expected '(' after 'while'.", this.current)
    else this.next()
    this.nesting += 1
    this.skipSoft()
    const condition = this.parseExpression()
    this.skipSoft()
    if (this.is(')')) this.next()
    else this.error('RB1121', "Expected ')' to close the while header.", this.current)
    this.nesting -= 1
    this.skipNewlines()
    const body = this.parseBlockOrStatement()
    return {
      type: 'while',
      condition,
      body,
      start: start.start,
      end: body?.end ?? condition?.end ?? start.end,
      line: start.line,
      endLine: body?.endLine ?? condition?.endLine ?? start.endLine,
    }
  }

  parseIf() {
    const start = this.next()
    this.skipSoft()
    if (!this.is('(')) this.error('RB1130', "Expected '(' after 'if'.", this.current)
    else this.next()
    this.nesting += 1
    this.skipSoft()
    const condition = this.parseExpression()
    this.skipSoft()
    if (this.is(')')) this.next()
    else this.error('RB1131', "Expected ')' to close the if condition.", this.current)
    this.nesting -= 1
    this.skipNewlines()
    const consequent = this.parseBlockOrStatement()
    const saved = this.pos
    this.skipNewlines()
    let alternate = null
    if (this.is('else')) {
      this.next()
      this.skipNewlines()
      alternate = this.is('if') ? this.parseIf() : this.parseBlockOrStatement()
    } else {
      this.pos = saved
    }
    const endNode = alternate ?? consequent
    return {
      type: 'if',
      condition,
      consequent,
      alternate,
      start: start.start,
      end: endNode?.end ?? condition?.end ?? start.end,
      line: start.line,
      endLine: endNode?.endLine ?? condition?.endLine ?? start.endLine,
    }
  }

  parseBlockOrStatement() {
    if (this.is('{')) return this.parseBlock()
    return this.parseStatement()
  }

  parseBlock() {
    const start = this.next()
    const program = this.parseProgram(true)
    let endToken = start
    if (this.is('}')) endToken = this.next()
    else this.error('RB1104', "Expected '}' to close the block.", this.current)
    return {
      type: 'block',
      body: program.body,
      start: start.start,
      end: endToken.end,
      line: start.line,
      endLine: endToken.endLine,
    }
  }

  parseExpression(minPrecedence = 0) {
    let left = this.parseUnary()
    while (true) {
      this.skipSoft()
      const token = this.current
      if (token.type !== 'op') break
      const precedence = PRECEDENCE.get(token.value)
      if (precedence === undefined || precedence < minPrecedence) break
      this.next()
      // Rev continues an expression across newlines after a binary operator.
      this.skipNewlines()
      const right = this.parseExpression(precedence + (RIGHT_ASSOC.has(token.value) ? 0 : 1))
      left = {
        type: 'binary',
        operator: token.value,
        left,
        right,
        start: left?.start ?? token.start,
        end: right?.end ?? token.end,
        line: left?.line ?? token.line,
        endLine: right?.endLine ?? token.endLine,
      }
    }
    return left
  }

  parseUnary() {
    this.skipSoft()
    const token = this.current
    if (token.type === 'op' && (token.value === '-' || token.value === '+' || token.value === '!' || token.value === '++' || token.value === '--')) {
      this.next()
      const argument = this.parseUnary()
      return {
        type: token.value === '++' || token.value === '--' ? 'increment' : 'unary',
        prefix: true,
        operator: token.value,
        argument,
        start: token.start,
        end: argument?.end ?? token.end,
        line: token.line,
        endLine: argument?.endLine ?? token.endLine,
      }
    }
    return this.parsePostfix()
  }

  parsePostfix() {
    let node = this.parsePrimary()
    while (true) {
      this.skipSoft()
      if (this.is('(')) {
        const argsInfo = this.parseCallArguments()
        node = {
          type: 'call',
          callee: node,
          args: argsInfo.args,
          start: node?.start ?? argsInfo.start,
          end: argsInfo.end,
          line: node?.line ?? argsInfo.line,
          endLine: argsInfo.endLine,
          openParen: argsInfo.openParen,
        }
        continue
      }
      if (this.is('[')) {
        const open = this.next()
        this.nesting += 1
        this.skipSoft()
        const indices = []
        while (!this.isType('eof') && !this.is(']')) {
          if (this.is(',')) {
            indices.push(null)
            this.next()
            this.skipSoft()
            continue
          }
          indices.push(this.parseExpression())
          this.skipSoft()
          if (this.is(',')) {
            this.next()
            this.skipSoft()
            continue
          }
          break
        }
        let endToken = open
        if (this.is(']')) endToken = this.next()
        else this.error('RB1140', "Expected ']' after index.", this.current)
        this.nesting -= 1
        node = {
          type: 'index',
          object: node,
          indices,
          index: indices.find((item) => item !== null) ?? null,
          start: node?.start ?? open.start,
          end: endToken.end,
          line: node?.line ?? open.line,
          endLine: endToken.endLine,
        }
        continue
      }
      if (this.current.type === 'op' && (this.is('++') || this.is('--'))) {
        const operator = this.next()
        node = {
          type: 'increment',
          prefix: false,
          operator: operator.value,
          argument: node,
          start: node?.start ?? operator.start,
          end: operator.end,
          line: node?.line ?? operator.line,
          endLine: operator.endLine,
        }
        continue
      }
      if (this.is('.')) {
        this.next()
        this.skipSoft()
        const property = this.current.type === 'ident' ? this.next() : null
        if (property === null) this.error('RB1141', "Expected a member name after '.'.", this.current)
        node = {
          type: 'member',
          object: node,
          property: property?.value ?? null,
          propertyToken: property,
          start: node?.start ?? property?.start ?? 0,
          end: property?.end ?? node?.end ?? 0,
          line: node?.line ?? property?.line ?? 1,
          endLine: property?.endLine ?? node?.endLine ?? 1,
        }
        continue
      }
      break
    }
    return node
  }

  parseCallArguments() {
    const open = this.next()
    this.nesting += 1
    const args = []
    this.skipSoft()
    if (this.is(')')) {
      const close = this.next()
      this.nesting -= 1
      return { args, start: open.start, end: close.end, line: open.line, endLine: close.endLine, openParen: open.start }
    }
    while (!this.isType('eof')) {
      this.skipSoft()
      if (this.is(')')) break
      let name = null
      let nameToken = null
      if (this.current.type === 'ident' && this.peek(1).value === '=') {
        nameToken = this.next()
        name = nameToken.value
        this.next()
        this.skipSoft()
      }
      const value = this.parseExpression()
      args.push({
        name,
        nameToken,
        value,
        start: nameToken?.start ?? value?.start ?? this.current.start,
        end: value?.end ?? this.current.end,
        line: nameToken?.line ?? value?.line ?? this.current.line,
        endLine: value?.endLine ?? this.current.endLine,
      })
      this.skipSoft()
      if (this.is(',')) {
        this.next()
        this.skipSoft()
        if (this.is(')')) break
        continue
      }
      if (this.is(')')) break
      this.error('RB1142', "Expected ',' or ')' in the argument list.", this.current)
      while (!this.isType('eof') && !this.is(')') && !this.is(',')) this.next()
      if (this.is(',')) {
        this.next()
        continue
      }
      break
    }
    let close = open
    if (this.is(')')) close = this.next()
    else this.error('RB1143', "Expected ')' to close the argument list.", this.current)
    this.nesting -= 1
    return { args, start: open.start, end: close.end, line: open.line, endLine: close.endLine, openParen: open.start }
  }

  parseFunctionDeclaration() {
    const start = this.next()
    this.skipSoft()
    const headStart = this.current.start
    let nameToken = null
    let scan = this.pos
    let depth = 0
    while (scan < this.tokens.length) {
      const token = this.tokens[scan]
      if (token.type === 'eof' || token.type === 'newline') break
      if (token.value === '[') depth += 1
      else if (token.value === ']') depth -= 1
      else if (depth === 0 && token.type === 'ident' && this.tokens[scan + 1]?.value === '(') {
        nameToken = token
        break
      }
      scan += 1
    }
    if (nameToken === null) {
      this.error('RB1162', 'Expected a typed function declaration: function <ReturnType> <name>(<Type> <arg>, ...).', this.current)
      return this.parsePrimary()
    }
    const returnType = this.tokens.slice(this.pos, scan).filter((t) => t.type !== 'newline').map((t) => t.value).join('')
    this.pos = scan
    this.next()
    this.skipSoft()
    const params = []
    if (this.is('(')) {
      const open = this.next()
      this.nesting += 1
      this.skipSoft()
      while (!this.isType('eof') && !this.is(')')) {
        const paramStart = this.pos
        let paramDepth = 0
        let paramNameToken = null
        let pScan = this.pos
        while (pScan < this.tokens.length) {
          const token = this.tokens[pScan]
          if (token.type === 'eof' || token.type === 'newline') break
          if (token.value === '[' || token.value === '<') paramDepth += 1
          else if (token.value === ']' || token.value === '>') paramDepth -= 1
          else if (paramDepth <= 0 && token.value === ',') break
          else if (paramDepth <= 0 && token.value === ')') break
          else if (paramDepth <= 0 && token.type === 'ident') paramNameToken = token
          pScan += 1
        }
        if (paramNameToken !== null) {
          const type = this.tokens.slice(paramStart, this.tokens.indexOf(paramNameToken)).map((t) => t.value).join('')
          params.push({ name: paramNameToken.value, token: paramNameToken, type, defaultValue: null })
        }
        this.pos = pScan
        if (this.is(',')) {
          this.next()
          this.skipSoft()
          continue
        }
        break
      }
      if (this.is(')')) this.next()
      else this.error('RB1163', "Expected ')' after function parameters.", this.current)
      this.nesting -= 1
    } else {
      this.error('RB1164', "Expected '(' after the function name.", this.current)
    }
    this.skipNewlines()
    const body = this.is('{') ? this.parseBlock() : this.parseExpression()
    return {
      type: 'functionDeclaration',
      name: nameToken.value,
      nameToken,
      returnType,
      params,
      body,
      start: start.start,
      end: body?.end ?? nameToken.end,
      line: start.line,
      endLine: body?.endLine ?? nameToken.endLine,
    }
  }

  parsePrimary() {
    this.skipSoft()
    const token = this.current
    if (token.type === 'ident') {
      if (token.value === 'function') return this.parseFunctionLiteral()
      this.next()
      if (token.value === 'TRUE' || token.value === 'FALSE') {
        return { type: 'boolean', value: token.value === 'TRUE', start: token.start, end: token.end, line: token.line, endLine: token.endLine }
      }
      if (token.value === 'NULL') {
        return { type: 'null', value: null, start: token.start, end: token.end, line: token.line, endLine: token.endLine }
      }
      return {
        type: 'ident',
        name: token.value,
        token,
        start: token.start,
        end: token.end,
        line: token.line,
        endLine: token.endLine,
      }
    }
    if (token.type === 'number') {
      this.next()
      return { type: 'number', value: token.value, raw: token.raw, token, start: token.start, end: token.end, line: token.line, endLine: token.endLine }
    }
    if (token.type === 'string') {
      this.next()
      return {
        type: 'string',
        value: token.value,
        raw: token.raw,
        terminated: token.terminated,
        token,
        start: token.start,
        end: token.end,
        line: token.line,
        endLine: token.endLine,
      }
    }
    if (this.is('(')) {
      const open = this.next()
      this.nesting += 1
      this.skipSoft()
      const expression = this.parseExpression()
      this.skipSoft()
      let close = open
      if (this.is(')')) close = this.next()
      else this.error('RB1150', "Expected ')' to close the parenthesized expression.", this.current)
      this.nesting -= 1
      return {
        type: 'group',
        expression,
        start: open.start,
        end: close.end,
        line: open.line,
        endLine: close.endLine,
      }
    }
    if (this.is('[')) {
      const open = this.next()
      this.nesting += 1
      const items = []
      this.skipSoft()
      while (!this.isType('eof') && !this.is(']')) {
        if (this.is(',')) {
          this.next()
          this.skipSoft()
          continue
        }
        items.push(this.parseExpression())
        this.skipSoft()
        if (this.is(',')) {
          this.next()
          this.skipSoft()
          if (this.is(']')) break
        } else break
      }
      let close = open
      if (this.is(']')) close = this.next()
      else this.error('RB1151', "Expected ']' to close the vector literal.", this.current)
      this.nesting -= 1
      return {
        type: 'vector',
        items,
        start: open.start,
        end: close.end,
        line: open.line,
        endLine: close.endLine,
      }
    }
    if (this.is('{')) return this.parseBlock()
    this.error('RB1105', `Expected an expression, found ${JSON.stringify(token.value)}.`, token)
    this.next()
    return {
      type: 'unknown',
      raw: token.value,
      start: token.start,
      end: token.end,
      line: token.line,
      endLine: token.endLine,
    }
  }

  parseFunctionLiteral() {
    const start = this.next()
    this.skipSoft()
    const params = []
    if (this.is('(')) {
      this.next()
      this.nesting += 1
      this.skipSoft()
      while (!this.isType('eof') && !this.is(')')) {
        if (this.current.type === 'ident') {
          const nameToken = this.next()
          let defaultValue = null
          this.skipSoft()
          if (this.is('=')) {
            this.next()
            this.skipSoft()
            defaultValue = this.parseExpression()
          }
          params.push({ name: nameToken.value, token: nameToken, defaultValue })
          this.skipSoft()
        }
        if (this.is(',')) {
          this.next()
          this.skipSoft()
          continue
        }
        break
      }
      if (this.is(')')) this.next()
      else this.error('RB1160', 'Expected \')\' after function parameters.', this.current)
      this.nesting -= 1
    } else {
      this.error('RB1161', "Expected '(' after 'function'.", this.current)
    }
    this.skipNewlines()
    const body = this.is('{') ? this.parseBlock() : this.parseExpression()
    return {
      type: 'function',
      params,
      body,
      start: start.start,
      end: body?.end ?? start.end,
      line: start.line,
      endLine: body?.endLine ?? start.endLine,
    }
  }
}

/**
 * Parse one Rev script.
 * @param {string} source
 * @returns {{program: object, tokens: object[], lexicalErrors: object[], syntaxErrors: object[], errors: object[]}}
 */
export function parse(source) {
  const { tokens, errors: lexicalErrors } = tokenize(source)
  const parser = new Parser(tokens)
  const program = parser.parseProgram(false)
  return {
    program,
    tokens,
    lexicalErrors,
    syntaxErrors: parser.errors,
    errors: [...lexicalErrors, ...parser.errors],
  }
}

export { KEYWORDS }
