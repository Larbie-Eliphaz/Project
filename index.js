import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import session from "express-session";
import bcrypt from "bcrypt";

const app = express();
const PORT = process.env.PORT || 3000;
const db = new pg.Client({
  user: "postgres",
  host: "localhost",
  database: "E-commerceDB",
  password: "EliphazLarbie3%",
  port: 5432,
});

db.connect();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");

app.use(
  session({
    secret: process.env.SESSION_SECRET || "default_secret_key",
    resave: false,
    saveUninitialized: true,
  })
);

// Middleware to make the current user available in all views
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// a function to check if a user is logged in
function isLoggedIn(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  res.redirect('/');
}


// ***************************************GET REQUESTS********************************************************************

app.get("/", async (req, res) => {
  const result = await db.query(
    "SELECT * FROM cars WHERE featured = true AND availability = true ORDER BY posted_at ASC LIMIT 6"
  );
  res.render("homepage.ejs", { featuredCars: result.rows });
});

app.get("/about", (req, res) => {
  res.render("about.ejs");
});

app.get("/login", (req, res) => {
  res.render("./auth/login.ejs");
});
app.get("/register", (req, res) => {
  res.render("./auth/register.ejs");
});

app.get("/contact", (req, res) => {
  res.render("contact.ejs");
});

app.get("/services", (req, res) => {
  res.send("Services page is under construction.");
  // res.render("services.ejs"); 
});

app.get('/browse', async(req, res)=>{
  const { type, make, transmission, sort } = req.query;
  // Initialize base query and parameters
  let baseQuery = `SELECT * FROM cars WHERE availability = true`;
  let params = [];
  let count = 1;

  // Apply filters
  if (type) {
    baseQuery += ` AND type = $${count++}`;
    params.push(type);
  }
  if (make) {
    baseQuery += ` AND make = $${count++}`;
    params.push(make);
  }
  if (transmission) {
    baseQuery += ` AND transmission = $${count++}`;
    params.push(transmission);
  }

  // Sorting logic
  let sortClause = "";
  switch (sort) {
    case "price-asc":
      sortClause = " ORDER BY price ASC";
      break;
    case "price-desc":
      sortClause = " ORDER BY price DESC";
      break;
    case "year-asc":
      sortClause = " ORDER BY year ASC";
      break;
    case "year-desc":
      sortClause = " ORDER BY year DESC";
      break;
    default:
      sortClause = " ORDER BY posted_at DESC";
  }

  try {
    const result = await db.query(baseQuery + sortClause, params);
    res.render("./garage/browse", { cars: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong...");
  }

})

app.get('/cars/:id', async (req, res) => {
  const carId = parseInt(req.params.id);
  if (isNaN(carId)) return res.status(400).send('Invalid car ID');

  try {
    const result = await db.query('SELECT * FROM cars WHERE id = $1', [carId]);

    if (result.rows.length === 0) {
      return res.status(404).send('Car not found');
    }

    const car = result.rows[0];
    res.render('./garage/cardetails', { car });

  } catch (err) {
    console.error('Error fetching car:', err);
    res.status(500).send('Something went wrong');
  }
});

app.get('/orders', isLoggedIn, async (req, res) => {
  const userId = req.session.user.id;

  try {
    const result = await db.query(`
      SELECT orders.*, cars.make, cars.model, cars.year, cars.image
      FROM orders
      JOIN cars ON orders.car_id = cars.id
      WHERE orders.user_id = $1
      ORDER BY orders.created_at DESC
    `, [userId]);

    res.render('./user/orders', { orders: result.rows });

  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to fetch orders');
  }
});


// ***************************************POST REQUESTS*********************************************************************
app.post("/login", async (req, res) => {
  const uname = req.body.email;
  const pswd = req.body.password;

  const result = await db.query("SELECT * FROM users WHERE email = $1", [uname]);
  const user = result.rows[0];

  if (!user) {
    return res.redirect("/login");
  }

  const passwordMatch = await bcrypt.compare(pswd, user.password);
  if (!passwordMatch) {
    return res.redirect("/login");
  }

  req.session.user = {
    id: user.id,
    username: user.firstname,
    role: user.role,
  };

  if (user.role == "user") {
    console.log(user);
    return res.redirect("/");
  }else if (user.role == "admin") {
    console.log(user);
    return res.redirect("/admin/dashboard");
  }
});

app.post('/register', async (req, res) => {
  const { firstname, lastname, email, password, phone, country, idcard } = req.body;
  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(password, saltRounds);
  await db.query(
    "INSERT INTO users (firstname, lastname, email, password, phone, country) VALUES ($1, $2, $3, $4, $5, $6)",
    [firstname, lastname, email, hashedPassword, phone, country]
  );

  res.redirect("/login");
});

app.post("/contact", async (req, res) => {
  const { name, email, message } = req.body;
  await db.query(
    "INSERT INTO requests (name, email, message) VALUES ($1, $2, $3)",
    [name, email, message]
  );
  res.redirect("/contact");
});

// buy car route handler
app.post('/buy/:carId', isLoggedIn, async (req, res) => {
  const carId = parseInt(req.params.carId);
  const userId = req.session.user.id;

  const check = await db.query('SELECT availability FROM cars WHERE id = $1', [carId]);
  if (!check.rows[0].availability) {
    req.flash('error', 'Sorry, this car is no longer available');
    return res.redirect('/browse');
  }

  await db.query(
    'INSERT INTO orders (user_id, car_id, order_type) VALUES ($1, $2, $3)',
    [userId, carId, 'buy']
  );
  await db.query('UPDATE cars SET availability = false WHERE id = $1', [carId]);

  // req.flash('success', 'Purchase request submitted!');
  res.redirect('/orders');
});

app.post('/rent/:carId', isLoggedIn, async (req, res) => {
  const { start_date, end_date } = req.body;
  const carId = parseInt(req.params.carId);
  const userId = req.session.user.id;

  const check = await db.query('SELECT availability FROM cars WHERE id = $1', [carId]);
  if (!check.rows[0].availability) {
    req.flash('error', 'Sorry, this car is no longer available');
    return res.redirect('/browse');
  }

  await db.query(
    `INSERT INTO orders (user_id, car_id, order_type) VALUES ($1, $2, 'rent')`,
    [userId, carId]
  );
  await db.query('UPDATE cars SET availability = false WHERE id = $1', [carId]);

  // req.flash('success', 'Rental request submitted!');
  res.redirect('/orders');
});



// ***************************************ADMIN REQUESTS*********************************************************************
// ***************************************ADMIN REQUESTS*********************************************************************
app.get('/admin/dashboard', isLoggedIn, requireAdmin, async (req, res) => {
  const [cars, available, orders, pending, users, confirmed, cancelled] = await Promise.all([
    db.query('SELECT COUNT(*) FROM cars'),
    db.query('SELECT COUNT(*) FROM cars WHERE availability = true'),
    db.query('SELECT COUNT(*) FROM orders'),
    db.query("SELECT COUNT(*) FROM orders WHERE status = 'pending'"),
    db.query('SELECT COUNT(*) FROM users'),
    db.query("SELECT COUNT(*) FROM orders WHERE status = 'confirmed'"),
    db.query("SELECT COUNT(*) FROM orders WHERE status = 'cancelled'"),
  ]);

  const stats = {
    totalCars: cars.rows[0].count,
    availableCars: available.rows[0].count,
    totalOrders: orders.rows[0].count,
    pendingOrders: pending.rows[0].count,
    totalUsers: users.rows[0].count,
    confirmedOrders: confirmed.rows[0].count,
    cancelledOrders: cancelled.rows[0].count
  };

  res.render('./admin/dashboard', { stats });
});

app.get('/admin/orders', isLoggedIn, requireAdmin, async (req, res) => {
  
  const result = await db.query(`
    SELECT 
      orders.id, orders.order_type, orders.status, orders.created_at,
      users.firstname,
      cars.id AS car_id, cars.make, cars.model, cars.year, cars.image, cars.price
    FROM orders
    JOIN users ON orders.user_id = users.id
    JOIN cars ON orders.car_id = cars.id
    ORDER BY orders.created_at DESC
  `);

  res.render('./admin/admin_orders', { orders: result.rows });
});

app.get('/admin/cars', isLoggedIn, requireAdmin, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  const countResult = await db.query('SELECT COUNT(*) FROM cars');
  const totalCars = parseInt(countResult.rows[0].count);
  const totalPages = Math.ceil(totalCars / limit);

  const carsResult = await db.query(`
    SELECT * FROM cars
    ORDER BY year DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);

  res.render('admin/cars', {
    cars: carsResult.rows,
    currentPage: page,
    totalPages
  });
});
// ***************************************ADMIN REQUESTS*********************************************************************
// ***************************************ADMIN REQUESTS*********************************************************************

// ********************************************ADD ONS************************************************
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
