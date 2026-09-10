const express = require('express');
const app = express();
require('dotenv').config();
const session = require('express-session');
const bcrypt = require('bcrypt');

const db = require('./config/db');

// ==============================
// SESSION
// ==============================
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8 // 8 jam
  }
}));

// ==============================
// MIDDLEWARE
// ==============================
app.use(express.json());

// ==============================
// LOGIN PROTECTION
// ==============================
function requireLogin(req, res, next) {
  const isLoggedIn = req.session && req.session.loggedIn;

  // Kalau sudah login dan membuka login.html
  // arahkan ke dashboard sesuai role
  if (req.path === '/login.html' && isLoggedIn) {
    if (req.session.user && req.session.user.role === 'user') {
      return res.redirect('/user-dashboard.html');
    }

    return res.redirect('/');
  }

  // Halaman yang boleh diakses tanpa login
  const publicPaths = [
    '/login.html',
    '/login'
  ];

  if (publicPaths.includes(req.path)) {
    return next();
  }

  // Logout tetap boleh diakses
  if (req.path === '/logout') {
    return next();
  }

  // Gambar boleh diakses tanpa login
  if (req.path.startsWith('/images/')) {
    return next();
  }

  // Kalau sudah login
  if (isLoggedIn) {
    return next();
  }

  // Kalau API dan belum login
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({
      error: 'Silakan login terlebih dahulu'
    });
  }

  // Halaman biasa dan belum login
  return res.redirect('/login.html');
}

app.use(requireLogin);

// ==============================
// STATIC FILE
// ==============================
app.use(express.static('public'));

// ==============================
// ROUTES
// ==============================

const jenisLinenRoutes = require('./routes/JenisLinen');
app.use('/api/jenis-linen', jenisLinenRoutes);

const serahTerimaRoutes = require('./routes/serahTerima');
app.use('/api/serah-terima', serahTerimaRoutes);

const stokRuanganRoutes = require('./routes/stokRuangan');
app.use('/api/stok-ruangan', stokRuanganRoutes);

const ruanganRoutes = require('./routes/ruangan');
app.use('/api/ruangan', ruanganRoutes);

// ==============================
// LOGIN
// ==============================
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // Validasi
  if (!username || !password) {
    return res.status(400).json({
      error: 'Username dan password wajib diisi'
    });
  }

  try {

    // ==================================
    // 1. CEK ADMIN DARI .ENV
    // ==================================
    if (
      username === process.env.ADMIN_USERNAME &&
      password === process.env.ADMIN_PASSWORD
    ) {

      req.session.loggedIn = true;

      req.session.user = {
        id: null,
        username: username,
        role: 'admin',
        ruangan_id: null
      };

      return res.json({
        message: 'Login admin berhasil',
        role: 'admin',
        redirect: '/'
      });
    }

    // ==================================
    // 2. CEK USER DARI DATABASE
    // ==================================
    const [rows] = await db.query(
      `
      SELECT
        id,
        username,
        password,
        role,
        ruangan_id
      FROM users
      WHERE username = ?
      LIMIT 1
      `,
      [username]
    );

    // Username tidak ditemukan
    if (rows.length === 0) {
      return res.status(401).json({
        error: 'Username atau password salah'
      });
    }

    const user = rows[0];

    // ==================================
    // 3. CEK PASSWORD BCRYPT
    // ==================================
    const passwordCocok = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordCocok) {
      return res.status(401).json({
        error: 'Username atau password salah'
      });
    }

    // ==================================
    // 4. USER HARUS PUNYA RUANGAN
    // ==================================
    if (user.role === 'user' && !user.ruangan_id) {
      return res.status(403).json({
        error: 'Akun user belum terhubung dengan ruangan'
      });
    }

    // ==================================
    // 5. SIMPAN SESSION
    // ==================================
    req.session.loggedIn = true;

    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      ruangan_id: user.ruangan_id
    };

    // ==================================
    // 6. REDIRECT SESUAI ROLE
    // ==================================
    if (user.role === 'admin') {
      return res.json({
        message: 'Login admin berhasil',
        role: 'admin',
        redirect: '/'
      });
    }

    return res.json({
      message: 'Login user berhasil',
      role: 'user',
      ruangan_id: user.ruangan_id,
      redirect: '/user-dashboard.html'
    });

  } catch (err) {
    console.error('Error login:', err);

    return res.status(500).json({
      error: 'Terjadi kesalahan pada server'
    });
  }
});

// ==============================
// LOGOUT
// ==============================
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {

    if (err) {
      console.error('Gagal logout:', err);

      return res.status(500).send('Gagal logout');
    }

    res.redirect('/login.html');
  });
});

// ==============================
// SERVER
// ==============================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server jalan di http://localhost:${PORT}`);
});