export function validateBody(schema) {
  return (req, res, next) => {
    const errors = []
    for (const [key, rule] of Object.entries(schema)) {
      const val = req.body?.[key]
      if (rule.required && (val === undefined || val === null || val === '')) {
        errors.push(`${key} is required`)
        continue
      }
      if (val !== undefined && val !== null) {
        if (rule.type === 'string' && typeof val !== 'string') {
          errors.push(`${key} must be a string`)
        }
        if (rule.type === 'number' && typeof val !== 'number') {
          errors.push(`${key} must be a number`)
        }
        if (rule.maxLength && String(val).length > rule.maxLength) {
          errors.push(`${key} exceeds max length ${rule.maxLength}`)
        }
        if (rule.pattern && !rule.pattern.test(String(val))) {
          errors.push(`${key} has invalid format`)
        }
      }
    }
    if (errors.length) {
      return res.status(400).json({ error: 'Validation failed', details: errors })
    }
    next()
  }
}

export function validateParam(name, opts = {}) {
  return (req, res, next) => {
    const val = req.params[name]
    if (!val || (opts.uuid && !/^[0-9a-f-]{36}$/i.test(val))) {
      return res.status(400).json({ error: `Invalid ${name}` })
    }
    next()
  }
}
