const express = require('express');
const app = express();
require('dotenv').config();
const session = require('express-session');

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // sesi login bertahan 8 jam
}));

app.use(express.json());

function requireLogin(req, res, next) {
  const publicPaths = ['/login.html', '/login', '/logout'];
  if (publicPaths.includes(req.path)) return next();
  if (req.path.startsWith('/images/')) return next(); // aset gambar boleh diakses tanpa login
  if (req.session && req.session.loggedIn) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
  }
  return res.redirect('/login.html');
}

app.use(requireLogin);

app.use(express.static('public'));

const jenisLinenRoutes = require('./routes/JenisLinen');
app.use('/api/jenis-linen', jenisLinenRoutes);

const serahTerimaRoutes = require('./routes/serahTerima');
app.use('/api/serah-terima', serahTerimaRoutes);

const stokRuanganRoutes = require('./routes/stokRuangan');
app.use('/api/stok-ruangan', stokRuanganRoutes);

const ruanganRoutes = require('./routes/ruangan');
app.use('/api/ruangan', ruanganRoutes);

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    req.session.loggedIn = true;
    return res.json({ message: 'Login berhasil' });
  }
  return res.status(401).json({ error: 'Username atau password salah' });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login.html');
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server jalan di http://localhost:${PORT}`));