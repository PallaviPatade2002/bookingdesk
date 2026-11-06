const jwt = require('jsonwebtoken');

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('Set JWT_SECRET in production');
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// bid = the business (tenant) the token belongs to; platform admins have no business
const sign = (user) => jwt.sign({ id: user.id, role: user.role, bid: user.business_id ?? null }, SECRET, { expiresIn: '7d' });

function requireAuth(...roles) {
  return (req, res, next) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    try {
      req.user = jwt.verify(token, SECRET);
    } catch {
      return res.status(401).json({ error: 'Login required' });
    }
    // a token only works inside the business it was issued for; platform routes accept only platform tokens
    const ok = req.biz ? req.user.bid === req.biz.id : req.user.role === 'platform';
    if (!ok) return res.status(401).json({ error: 'Login required' });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    next();
  };
}

module.exports = { sign, requireAuth };
