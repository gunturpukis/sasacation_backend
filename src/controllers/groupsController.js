// src/controllers/groupsController.js
// A2 (audit Figma): Group Budget Equity — budget bersama, pengeluaran per
// anggota, dan kartu "Spending Gap Detected" bila belanja melewati budget.
//
// Equity: fair share = total belanja / jumlah anggota; balance = dibayar -
// share (positif = anggota itu nalangi, negatif = berutang ke kas grup).

const pool = require('../config/db');

async function isMember(groupId, userId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );
  return rows.length > 0;
}

async function getGroup(groupId) {
  const { rows } = await pool.query('SELECT * FROM trip_groups WHERE id = $1', [groupId]);
  return rows[0] || null;
}

async function buildSummary(group) {
  const [{ rows: members }, { rows: expenses }] = await Promise.all([
    pool.query(
      `SELECT u.id, u.name, u.avatar FROM group_members m
       JOIN users u ON u.id = m.user_id WHERE m.group_id = $1 ORDER BY m.joined_at`,
      [group.id]
    ),
    pool.query('SELECT * FROM group_expenses WHERE group_id = $1 ORDER BY spent_at DESC', [group.id]),
  ]);

  const totalSpent = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const budget = Number(group.budget_total);
  const memberCount = Math.max(1, members.length);
  const fairShare = totalSpent / memberCount;

  const perMember = members.map((m) => {
    const paid = expenses.filter((e) => e.user_id === m.id).reduce((s, e) => s + Number(e.amount), 0);
    return { user_id: m.id, name: m.name, avatar: m.avatar, paid, fair_share: fairShare, balance: paid - fairShare };
  });

  // gap_status untuk kartu Figma: 'over' (> budget), 'near' (>= 85%),
  // 'under' (< 85%). Tanpa budget (>0) tidak ada gap yang bisa dihitung.
  let gapStatus = 'none';
  let pctOver = 0;
  if (budget > 0) {
    const pct = (totalSpent / budget) * 100;
    gapStatus = pct > 100 ? 'over' : pct >= 85 ? 'near' : 'under';
    pctOver = pct > 100 ? Math.round(pct - 100) : 0;
  }

  return {
    ...group,
    budget_total: budget,
    total_spent: totalSpent,
    remaining: budget - totalSpent,
    member_count: members.length,
    members: perMember,
    expenses,
    gap_status: gapStatus,
    pct_over: pctOver,
  };
}

// POST /api/groups — body { name, destination?, budget_total?, currency? }
const createGroup = async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, destination, budget_total = 0, currency = 'USD' } = req.body;
    if (!name || !String(name).trim())
      return res.status(400).json({ success: false, message: 'name wajib diisi' });
    if (Number(budget_total) < 0)
      return res.status(400).json({ success: false, message: 'budget_total tidak boleh negatif' });

    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO trip_groups (owner_id, name, destination, budget_total, currency)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, String(name).trim().slice(0, 100), destination || null, Number(budget_total) || 0, currency || 'USD']
    );
    await client.query('INSERT INTO group_members (group_id, user_id) VALUES ($1,$2)', [rows[0].id, req.user.id]);
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: await buildSummary(rows[0]) });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  } finally {
    client.release();
  }
};

// GET /api/groups/my
const getMyGroups = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.* FROM trip_groups g JOIN group_members m ON m.group_id = g.id
       WHERE m.user_id = $1 ORDER BY g.created_at DESC`,
      [req.user.id]
    );
    const data = [];
    for (const g of rows) data.push(await buildSummary(g));
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// GET /api/groups/:id — ringkas + anggota + equity (khusus anggota)
const getGroupById = async (req, res) => {
  try {
    const group = await getGroup(req.params.id);
    if (!group || !(await isMember(group.id, req.user.id)))
      return res.status(404).json({ success: false, message: 'Grup tidak ditemukan' });
    res.json({ success: true, data: await buildSummary(group) });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// POST /api/groups/:id/members — owner tambah via email
const addMember = async (req, res) => {
  try {
    const group = await getGroup(req.params.id);
    if (!group) return res.status(404).json({ success: false, message: 'Grup tidak ditemukan' });
    if (group.owner_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'Hanya pemilik grup yang bisa tambah anggota' });
    if (!req.body.email) return res.status(400).json({ success: false, message: 'email wajib diisi' });

    const { rows: users } = await pool.query('SELECT id FROM users WHERE email = $1', [String(req.body.email).toLowerCase()]);
    if (users.length === 0) return res.status(404).json({ success: false, message: 'User dengan email itu tidak ditemukan' });

    await pool.query(
      'INSERT INTO group_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [group.id, users[0].id]
    );
    res.status(201).json({ success: true, data: await buildSummary(group) });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// DELETE /api/groups/:id/members/:userId — owner keluarkan siapa saja;
// anggota biasa hanya boleh keluar sendiri.
const removeMember = async (req, res) => {
  try {
    const group = await getGroup(req.params.id);
    if (!group) return res.status(404).json({ success: false, message: 'Grup tidak ditemukan' });
    const target = req.params.userId;
    if (group.owner_id !== req.user.id && target !== req.user.id)
      return res.status(403).json({ success: false, message: 'Tidak berhak mengeluarkan anggota ini' });
    if (target === group.owner_id)
      return res.status(400).json({ success: false, message: 'Pemilik grup tidak bisa keluar — hapus grupnya' });

    await pool.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [group.id, target]);
    res.json({ success: true, message: 'Anggota dikeluarkan' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// POST /api/groups/:id/expenses — anggota catat pengeluaran
const addExpense = async (req, res) => {
  try {
    const group = await getGroup(req.params.id);
    if (!group || !(await isMember(group.id, req.user.id)))
      return res.status(404).json({ success: false, message: 'Grup tidak ditemukan' });
    const { label, amount, category, spent_at } = req.body;
    if (!label || !String(label).trim())
      return res.status(400).json({ success: false, message: 'label wajib diisi' });
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0)
      return res.status(400).json({ success: false, message: 'amount wajib angka positif' });

    const { rows } = await pool.query(
      `INSERT INTO group_expenses (group_id, user_id, label, amount, category, spent_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [group.id, req.user.id, String(label).trim().slice(0, 100), Number(amount), category || null, spent_at || new Date()]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// DELETE /api/groups/:id/expenses/:expenseId — yang bayar atau owner
const deleteExpense = async (req, res) => {
  try {
    const group = await getGroup(req.params.id);
    if (!group || !(await isMember(group.id, req.user.id)))
      return res.status(404).json({ success: false, message: 'Grup tidak ditemukan' });
    const { rowCount } = await pool.query(
      `DELETE FROM group_expenses WHERE id = $1 AND group_id = $2 AND (user_id = $3 OR $4 = $5)`,
      [req.params.expenseId, group.id, req.user.id, req.user.id, group.owner_id]
    );
    if (rowCount === 0) return res.status(404).json({ success: false, message: 'Pengeluaran tidak ditemukan' });
    res.json({ success: true, message: 'Pengeluaran dihapus' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// DELETE /api/groups/:id — hanya owner (members/expenses CASCADE)
const deleteGroup = async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM trip_groups WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
    if (rowCount === 0)
      return res.status(404).json({ success: false, message: 'Grup tidak ditemukan atau bukan milik Anda' });
    res.json({ success: true, message: 'Grup dihapus' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

module.exports = {
  createGroup, getMyGroups, getGroupById, addMember, removeMember,
  addExpense, deleteExpense, deleteGroup,
};
