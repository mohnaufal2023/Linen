const express = require('express');
const app = express();
const path = require('path');

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


// ==========================================================
// HAK AKSES HALAMAN BERDASARKAN ROLE
// ==========================================================
const pageAccess = {

  // ==============================
  // ADMIN
  // ==============================
  '/': ['admin'],
  '/index.html': ['admin'],
  '/kelola-linen.html': ['admin'],
  '/kelola-ruangan.html': ['admin'],
  '/stock-ruangan.html': ['admin'],

  // ==============================
  // ADMIN + LAUNDRY
  // ==============================
  '/form.html': ['admin', 'laundry'],

  // ==============================
  // ADMIN + LAUNDRY + USER
  // ==============================
  '/riwayat.html': ['admin', 'laundry', 'user'],

  // ==============================
  // LAUNDRY
  // ==============================
  '/laundry-dashboard.html': ['laundry'],
  '/stok-laundry.html': ['admin', 'laundry'],

  // ==============================
  // USER RUANGAN
  // ==============================
  '/user-dashboard.html': ['user'],
  '/konfirmasi.html': ['user']
};


// ==========================================================
// LOGIN PROTECTION
// ==========================================================
function requireLogin(req, res, next) {

  const isLoggedIn =
    req.session &&
    req.session.loggedIn;

  const role =
    req.session?.user?.role;


  // =========================================
  // HALAMAN LOGIN
  // =========================================
  if (req.path === '/login.html') {

    // Sudah login
    if (isLoggedIn) {

      if (role === 'admin') {
        return res.redirect('/');
      }

      if (role === 'laundry') {
        return res.redirect('/laundry-dashboard.html');
      }

      if (role === 'user') {
        return res.redirect('/user-dashboard.html');
      }

      return res.redirect('/login.html');
    }

    return next();
  }


  // =========================================
  // API LOGIN
  // =========================================
  if (req.path === '/login') {
    return next();
  }


  // =========================================
  // LOGOUT
  // =========================================
  if (req.path === '/logout') {
    return next();
  }


  // =========================================
  // GAMBAR
  // =========================================
  if (req.path.startsWith('/images/')) {
    return next();
  }


  // =========================================
  // BELUM LOGIN
  // =========================================
  if (!isLoggedIn) {

    // API
    if (req.path.startsWith('/api/')) {

      return res.status(401).json({
        error: 'Silakan login terlebih dahulu'
      });

    }

    // Halaman
    return res.redirect('/login.html');
  }


  // ========================================================
  // USER SUDAH LOGIN
  // SEKARANG CEK HAK AKSES HALAMAN
  // ========================================================

  const allowedRoles =
    pageAccess[req.path];


  // =========================================
  // HALAMAN YANG ADA DI DAFTAR pageAccess
  // =========================================
  if (allowedRoles) {

    if (!allowedRoles.includes(role)) {

      // =====================================
      // ADMIN
      // =====================================
      if (role === 'admin') {
        return res.redirect('/');
      }

      // =====================================
      // LAUNDRY
      // =====================================
      if (role === 'laundry') {
        return res.redirect('/laundry-dashboard.html');
      }

      // =====================================
      // USER
      // =====================================
      if (role === 'user') {
        return res.redirect('/user-dashboard.html');
      }

      return res.redirect('/login.html');
    }

    return next();
  }


  // ========================================================
  // HTML YANG TIDAK TERDAFTAR
  // ========================================================
  if (
    req.path.endsWith('.html') ||
    req.path === '/'
  ) {

    // Tolak halaman HTML yang belum diberi izin
    // agar tidak ada halaman yang bocor antar-role.

    if (role === 'admin') {
      return res.redirect('/');
    }

    if (role === 'laundry') {
      return res.redirect('/laundry-dashboard.html');
    }

    if (role === 'user') {
      return res.redirect('/user-dashboard.html');
    }

    return res.redirect('/login.html');
  }


  // =========================================
  // API YANG SUDAH LOGIN
  // =========================================
  if (req.path.startsWith('/api/')) {
    return next();
  }


  // =========================================
  // FILE LAIN
  // =========================================
  return next();
}


app.use(requireLogin);


// ==============================
// STATIC FILE
// ==============================
app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);


// ==========================================================
// INFO USER YANG SEDANG LOGIN
// ==========================================================
app.get('/api/me', async (req, res) => {

  if (
    !req.session ||
    !req.session.loggedIn ||
    !req.session.user
  ) {

    return res.status(401).json({
      error: 'Silakan login terlebih dahulu'
    });

  }


  try {

    const userSession =
      req.session.user;


    // ==================================
    // ADMIN
    // ==================================
    if (userSession.role === 'admin') {

      return res.json({
        user: {
          id: null,
          username: userSession.username,
          role: 'admin',
          ruangan_id: null,
          ruangan_nama: null
        }
      });

    }


    // ==================================
    // LAUNDRY
    // ==================================
    if (userSession.role === 'laundry') {

      return res.json({
        user: {
          id: userSession.id,
          username: userSession.username,
          role: 'laundry',
          ruangan_id: null,
          ruangan_nama: null
        }
      });

    }


    // ==================================
    // USER RUANGAN
    // ==================================
    if (userSession.role === 'user') {

      const [rows] = await db.query(
        `SELECT
          u.id,
          u.username,
          u.role,
          u.ruangan_id,
          r.nama AS ruangan_nama
         FROM users u
         LEFT JOIN ruangan r
           ON r.id = u.ruangan_id
         WHERE u.id = ?
         LIMIT 1`,
        [userSession.id]
      );


      if (rows.length === 0) {

        return res.status(404).json({
          error: 'Data user tidak ditemukan'
        });

      }


      return res.json({
        user: rows[0]
      });

    }


    return res.status(403).json({
      error: 'Role akun tidak dikenali'
    });


  } catch (err) {

    console.error(
      'Error /api/me:',
      err
    );

    return res.status(500).json({
      error: 'Gagal mengambil informasi akun'
    });

  }

});


// ==============================
// ROUTES
// ==============================

const jenisLinenRoutes =
  require('./routes/JenisLinen');

app.use(
  '/api/jenis-linen',
  jenisLinenRoutes
);


const serahTerimaRoutes =
  require('./routes/serahTerima');

app.use(
  '/api/serah-terima',
  serahTerimaRoutes
);


const stokRuanganRoutes =
  require('./routes/stokRuangan');

app.use(
  '/api/stok-ruangan',
  stokRuanganRoutes
);

const stokLaundryRoutes =
  require('./routes/stokLaundry');

app.use(
  '/api/stok-laundry',
  stokLaundryRoutes
);


const ruanganRoutes =
  require('./routes/ruangan');

app.use(
  '/api/ruangan',
  ruanganRoutes
);


// ==========================================================
// LOGIN
// ==========================================================
app.post('/login', async (req, res) => {

  const {
    username,
    password
  } = req.body;


  // ==================================
  // VALIDASI
  // ==================================
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
        username,
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
    // 2. CEK USER DATABASE
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


    // ==================================
    // USER TIDAK DITEMUKAN
    // ==================================
    if (rows.length === 0) {

      return res.status(401).json({
        error: 'Username atau password salah'
      });

    }


    const user =
      rows[0];


    // ==================================
    // 3. CEK PASSWORD BCRYPT
    // ==================================
    const passwordCocok =
      await bcrypt.compare(
        password,
        user.password
      );


    if (!passwordCocok) {

      return res.status(401).json({
        error: 'Username atau password salah'
      });

    }


    // ==================================
    // 4. USER RUANGAN WAJIB PUNYA RUANGAN
    // ==================================
    if (
      user.role === 'user' &&
      !user.ruangan_id
    ) {

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
    // 6. REDIRECT ADMIN
    // ==================================
    if (user.role === 'admin') {

      return res.json({
        message: 'Login admin berhasil',
        role: 'admin',
        redirect: '/'
      });

    }


    // ==================================
    // 7. REDIRECT LAUNDRY
    // ==================================
    if (user.role === 'laundry') {

      return res.json({
        message: 'Login laundry berhasil',
        role: 'laundry',
        redirect: '/laundry-dashboard.html'
      });

    }


    // ==================================
    // 8. REDIRECT USER RUANGAN
    // ==================================
    if (user.role === 'user') {

      return res.json({
        message: 'Login user berhasil',
        role: 'user',
        ruangan_id: user.ruangan_id,
        redirect: '/user-dashboard.html'
      });

    }


    return res.status(403).json({
      error: 'Role akun tidak dikenali'
    });


  } catch (err) {

    console.error(
      'Error login:',
      err
    );

    return res.status(500).json({
      error: 'Terjadi kesalahan pada server'
    });

  }

});


// ==========================================================
// LOGOUT
// ==========================================================
app.get('/logout', (req, res) => {

  req.session.destroy((err) => {

    if (err) {

      console.error(
        'Gagal logout:',
        err
      );

      return res.status(500).send(
        'Gagal logout'
      );

    }

    res.redirect('/login.html');

  });

});


// ==========================================================
// SERVER
// ==========================================================
const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(
    `Server jalan di http://localhost:${PORT}`
  );

});