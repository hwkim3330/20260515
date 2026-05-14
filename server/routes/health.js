'use strict';
const { Router } = require('express');
const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    ok:      true,
    service: 'ethernet-packet-lab-manager',
    time:    new Date().toISOString()
  });
});

module.exports = router;
