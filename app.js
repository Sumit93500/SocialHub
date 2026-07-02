require('dotenv').config();

const userModel = require("./models/user");
const postModel = require("./models/post");
const path = require('path');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const jwt = require("jsonwebtoken");
const fs = require('fs');
const express = require('express');
const upload = require('./config/multerconfig');
const validator = require('validator');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

function isLoggedIn(req, res, next) {
  if (!req.cookies.token) {
    return res.redirect('/login');
  }

  try {
    const data = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
    req.user = data;
    next();
  } catch (error) {
    res.cookie('token', '', { maxAge: 0 });
    return res.redirect('/login');
  }
}

function getReturnTo(req, defaultUrl = "/profile") {
  const body = req.body || {};
  const query = req.query || {};

  let target =
    body.returnTo ||
    query.returnTo ||
    req.get("referer") ||
    defaultUrl;

  if (query.scrollTo) {
    const anchor = query.scrollTo.startsWith("#")
      ? query.scrollTo
      : "#" + query.scrollTo;

    if (!target.includes(anchor)) {
      target += anchor;
    }
  }

  return target;
}

app.get('/', (req, res) => {
  res.render("index");
});

app.get('/profile/upload', isLoggedIn, (req, res) => {
  res.render("profileupload");
});

app.post('/upload', isLoggedIn, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }

    const user = await userModel.findById(req.user.userid);

    if (!user) {
      res.cookie('token', '', { maxAge: 0 });
      return res.redirect('/login');
    }

    user.profilepic = req.file.filename;
    await user.save();

    res.redirect("/profile");
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).send('Error uploading profile picture');
  }
});

app.get("/like/:id", isLoggedIn, async (req, res) => {
  try {
    const post = await postModel.findById(req.params.id);

    if (!post) {
      return res.status(404).send("Post not found");
    }

    const userId = String(req.user.userid);

    if (!post.likes) {
      post.likes = [];
    }

    const alreadyLiked = post.likes.some(
      like => String(like) === userId
    );

    if (alreadyLiked) {
      post.likes = post.likes.filter(
        like => String(like) !== userId
      );
    } else {
      post.likes.push(userId);
    }

    await post.save();

    res.redirect(getReturnTo(req, "/profile"));
  } catch (error) {
    console.error("Like Error:", error);
    res.status(500).send(error.message);
  }
});

app.get("/edit/:id", isLoggedIn, async (req, res) => {
  try {
    const post = await postModel.findOne({ _id: req.params.id }).populate("user");

    if (!post) {
      return res.status(404).send('Post not found');
    }

    if (post.user._id.toString() !== req.user.userid.toString()) {
      return res.status(403).send('You can only edit your own posts');
    }

    res.render("edit", { post });
  } catch (error) {
    console.error('Edit Page Error:', error);
    res.status(500).send('Error loading edit page');
  }
});

app.post('/comment/:id', isLoggedIn, async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).send('Comment cannot be empty');
    }

    const post = await postModel.findById(req.params.id);

    if (!post) {
      return res.status(404).send('Post not found');
    }

    post.comments.push({
      user: req.user.userid,
      text: text.trim()
    });

    await post.save();

    res.redirect(getReturnTo(req, '/profile'));
  } catch (error) {
    console.error('Comment Error:', error);
    res.status(500).send('Error adding comment');
  }
});

app.post("/update/:id", isLoggedIn, async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).send('Post content cannot be empty');
    }

    const post = await postModel.findOne({ _id: req.params.id }).populate("user");

    if (!post) {
      return res.status(404).send('Post not found');
    }

    if (post.user._id.toString() !== req.user.userid.toString()) {
      return res.status(403).send('You can only edit your own posts');
    }

    await postModel.findOneAndUpdate(
      { _id: req.params.id },
      { content: content.trim() }
    );

    res.redirect("/profile");
  } catch (error) {
    console.error('Update Post Error:', error);
    res.status(500).send('Error updating post');
  }
});

app.post('/register', async (req, res) => {
  fs.appendFileSync(
    './debug.log',
    `[${new Date().toISOString()}] POST /register called with body: ${JSON.stringify(req.body)}\n`
  );

  try {
    let { email, password, username, name, age } = req.body;
    age = Number(age);

    if (!email || !password || !username || !name || !age) {
      return res.status(400).send('All fields are required');
    }

    if (!validator.isEmail(email)) {
      return res.status(400).send('Invalid email format');
    }

    if (password.length < 6) {
      return res.status(400).send('Password must be at least 6 characters');
    }

    if (!Number.isInteger(age) || age < 13) {
      return res.status(400).send('Age must be at least 13');
    }

    const existingUser = await userModel.findOne({ email });

    if (existingUser) {
      return res.status(400).send('User already registered');
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    await userModel.create({
      username,
      email,
      age,
      name,
      password: hash
    });

    res.redirect('/login');
  } catch (error) {
    console.error('Registration Error:', error);

    fs.appendFileSync(
      './debug.log',
      `[${new Date().toISOString()}] ERROR: ${error.message}\nStack: ${error.stack}\n`
    );

    res.status(500).send('Error during registration');
  }
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).send('Email and password required');
    }

    if (!validator.isEmail(email)) {
      return res.status(400).send('Invalid email format');
    }

    const user = await userModel.findOne({ email });

    if (!user) {
      return res.status(401).send('Invalid email or password');
    }

    const result = await bcrypt.compare(password, user.password);

    if (!result) {
      return res.status(401).send('Invalid email or password');
    }

    const token = jwt.sign(
      {
        email: user.email,
        userid: user._id.toString()
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const cookieOptions = {
      httpOnly: true,
      sameSite: "None"
    };

    if (process.env.NODE_ENV === 'production') {
      cookieOptions.secure = true;
    }

    res.cookie('token', token, cookieOptions);
    res.redirect("/profile");
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).send('Error during login');
  }
});

app.get('/profile', isLoggedIn, async (req, res) => {
  try {
    const user = await userModel.findById(req.user.userid).populate("posts");

    if (!user) {
      res.cookie('token', '', { maxAge: 0 });
      return res.redirect('/login');
    }

    const posts = await postModel.find()
      .populate("user")
      .populate("comments.user")
      .sort({ date: -1 });

    res.render('profile', { user, posts });
  } catch (error) {
    console.error('Profile Error:', error);
    res.status(500).send('Error loading profile');
  }
});

app.get('/user/:id', isLoggedIn, async (req, res) => {
  try {
    const currentUser = await userModel.findById(req.user.userid);
    const profileUser = await userModel.findById(req.params.id).populate('posts');

    if (!currentUser) {
      res.cookie('token', '', { maxAge: 0 });
      return res.redirect('/login');
    }

    if (!profileUser) {
      return res.status(404).send('User not found');
    }

    const posts = await postModel.find({ user: profileUser._id })
      .populate('user')
      .populate('comments.user')
      .sort({ date: -1 });

    res.render('userprofile', { currentUser, profileUser, posts });
  } catch (error) {
    console.error('User Profile Error:', error);
    res.status(500).send('Error loading user profile');
  }
});

app.post('/post', isLoggedIn, upload.single('image'), async (req, res) => {
  try {
    const user = await userModel.findById(req.user.userid);

    if (!user) {
      res.cookie('token', '', { maxAge: 0 });
      return res.redirect('/login');
    }

    const { content } = req.body;
    const image = req.file ? req.file.filename : null;

    if ((!content || content.trim().length === 0) && !image) {
      return res.status(400).send('Post must include text or an image');
    }

    const post = await postModel.create({
      user: user._id,
      content: content ? content.trim() : '',
      image
    });

    user.posts.push(post._id);
    await user.save();

    res.redirect('/profile');
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).send('Error creating post: ' + error.message);
  }
});

app.get('/delete/:id', isLoggedIn, async (req, res) => {
  try {
    const post = await postModel.findOne({ _id: req.params.id }).populate("user");

    if (!post) {
      return res.status(404).send('Post not found');
    }

    if (post.user._id.toString() !== req.user.userid.toString()) {
      return res.status(403).send('You can only delete your own posts');
    }

    await postModel.findByIdAndDelete(req.params.id);
    await userModel.findByIdAndUpdate(req.user.userid, {
      $pull: { posts: req.params.id }
    });

    res.redirect('/profile');
  } catch (error) {
    console.error('Delete Post Error:', error);
    res.status(500).send('Error deleting post');
  }
});

app.get('/logout', (req, res) => {
  const cookieOptions = {
    httpOnly: true,
    sameSite: "None",
    maxAge: 0
  };

  if (process.env.NODE_ENV === 'production') {
    cookieOptions.secure = true;
  }

  res.cookie("token", "", cookieOptions);
  res.redirect("/login");
});

app.use((err, req, res, next) => {
  console.error(err.stack);

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).send('File size too large. Maximum 5MB allowed.');
  }

  if (err.message && err.message.includes('Only image files')) {
    return res.status(400).send(err.message);
  }

  res.status(500).send('Something went wrong on our server');
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server is running...");
});