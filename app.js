require('dotenv').config();
console.log('✓ Dotenv loaded');
console.log('JWT_SECRET:', process.env.JWT_SECRET);
console.log('MONGO_URL:', process.env.MONGO_URL ? 'Set' : 'Not set');

const userModel = require("./models/user");
const postModel = require("./models/post");
const path = require('path');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const jwt = require("jsonwebtoken");
const fs = require('fs'); // Import fs module
const express = require('express');
const app = express();
const upload = require('./config/multerconfig');
const validator = require('validator');

// ================= MIDDLEWARE =================
app.set('view engine','ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,'public')));
app.use(cookieParser());

// Log all requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ================= AUTH MIDDLEWARE =================
function isLoggedIn(req,res,next){
  if(!req.cookies.token){
    return res.redirect('/login');
  }
  try {
    let data = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
    req.user = data;
    next();
  } catch (error) {
    res.cookie('token', '', { maxAge: 0 });
    res.redirect('/login');
  }
}

function getReturnTo(req, defaultUrl = '/profile') {
  let target = req.body.returnTo || req.query.returnTo || req.get('referer') || defaultUrl;
  if (req.query.scrollTo) {
    let anchor = req.query.scrollTo.startsWith('#') ? req.query.scrollTo : `#${req.query.scrollTo}`;
    if (!target.includes(anchor)) {
      target += anchor;
    }
  }
  return target;
}

// ================= HOME ROUTE =================
app.get('/',(req,res)=>{
  res.render("index");
});

// ================= PROFILE UPLOAD PAGE =================
app.get('/profile/upload',(req,res)=>{
  res.render("profileupload");
});

// ================= UPLOAD PROFILE PICTURE =================
app.post('/upload',isLoggedIn,upload.single("image"),async (req,res)=>{
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }
    let user = await userModel.findOne({email: req.user.email});
    user.profilepic = req.file.filename;
    await user.save();
    res.redirect("/profile");
  } catch (error) {
    res.status(500).send('Error uploading profile picture');
  }
});

// ================= LIKE POST =================
app.get("/like/:id", isLoggedIn, async (req, res) => {
  try {
    console.log("===== LIKE ROUTE =====");
    console.log("Post ID:", req.params.id);
    console.log("User:", req.user);

    let post = await postModel.findById(req.params.id);

    if (!post) {
      console.log("Post not found");
      return res.status(404).send("Post not found");
    }

    console.log("Likes array:", post.likes);

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

    console.log("Like updated successfully");

    res.redirect(getReturnTo(req, "/profile"));

  } catch (error) {
    console.error("LIKE ERROR:");
    console.error(error);
    res.status(500).send(error.message);
  }
});

// ================= EDIT POST PAGE =================
app.get("/edit/:id",isLoggedIn,async(req,res)=>{
  try {
    let post = await postModel.findOne({_id:req.params.id}).populate("user");
    if(!post) return res.status(404).send('Post not found');
    if(post.user._id.toString() !== req.user.userid.toString()) {
      return res.status(403).send('You can only edit your own posts');
    }
    res.render("edit",{post});
  } catch (error) {
    res.status(500).send('Error loading edit page');
  }
});

// ================= COMMENT ON POST =================
app.post('/comment/:id',isLoggedIn,async(req,res)=>{
  try {
    let {text} = req.body;
    if (!text || text.trim().length === 0) {
      return res.status(400).send('Comment cannot be empty');
    }
    let post = await postModel.findById(req.params.id);
    if(!post) return res.status(404).send('Post not found');

    post.comments.push({
      user: req.user.userid,
      text: text.trim()
    });
    await post.save();
    res.redirect(getReturnTo(req, '/profile'));
  } catch (error) {
    res.status(500).send('Error adding comment');
  }
});

// ================= UPDATE POST =================
app.post("/update/:id",isLoggedIn,async(req,res)=>{
  try {
    let {content} = req.body;
    if (!content || content.trim().length === 0) {
      return res.status(400).send('Post content cannot be empty');
    }
    let post = await postModel.findOne({_id:req.params.id}).populate("user");
    if(!post) return res.status(404).send('Post not found');
    if(post.user._id.toString() !== req.user.userid.toString()) {
      return res.status(403).send('You can only edit your own posts');
    }
    await postModel.findOneAndUpdate({_id:req.params.id},{content});
    res.redirect("/profile");
  } catch (error) {
    res.status(500).send('Error updating post');
  }
});

// ================= REGISTER =================
app.post('/register',async(req,res)=>{
 fs.appendFileSync(
  './debug.log',
  `[${new Date().toISOString()}] POST /register called with body: ${JSON.stringify(req.body)}\n`
);
  try {
    let {email,password,username,name,age}=req.body;
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
    if (!Number.isInteger(Number(age)) || age < 13) {
      return res.status(400).send('Age must be at least 13');
    }
    
    let user = await userModel.findOne({email});
    if(user) return res.status(400).send('User already registered');
    
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
    console.error('Registration Error:', error.message);
   fs.appendFileSync(
  './debug.log',
  `[${new Date().toISOString()}] ERROR: ${error.message}\nStack: ${error.stack}\n`
);
    res.status(500).send('Error during registration');
  }
});

app.get('/login',(req,res)=>{
  res.render('login');
});

// ================= LOGIN =================
app.post('/login',async(req,res)=>{
  try {
    let {email,password}=req.body;
    if (!email || !password) {
      return res.status(400).send('Email and password required');
    }
    if (!validator.isEmail(email)) {
      return res.status(400).send('Invalid email format');
    }
    
    let user = await userModel.findOne({email});
    if(!user) return res.status(401).send('Invalid email or password');
    
    const result = await bcrypt.compare(password,user.password);
    
    if(result) {
      let token = jwt.sign({email, userid:user._id}, process.env.JWT_SECRET);
      let cookieOptions = {
        httpOnly: true,
        sameSite: "None"
      };
      if (process.env.NODE_ENV === 'production') {
        cookieOptions.secure = true;
      }
      res.cookie('token', token, cookieOptions);
      res.redirect("/profile");
    } else {
      res.status(401).send('Invalid email or password');
    }
  } catch (error) {
    console.error('Login Error:', error.message);
    res.status(500).send('Error during login');
  }
});

// ================= PROFILE PAGE =================
app.get('/profile',isLoggedIn,async(req,res)=>{
  try {
    let user = await userModel.findOne({email:req.user.email}).populate("posts");
    let posts = await postModel.find()
      .populate("user")
      .populate("comments.user")
      .sort({date:-1});
    res.render('profile',{user, posts});
  } catch (error) {
    res.status(500).send('Error loading profile');
  }
});

// ================= VIEW OTHER USER PROFILE =================
app.get('/user/:id',isLoggedIn,async(req,res)=>{
  try {
    let currentUser = await userModel.findOne({email:req.user.email});
    let profileUser = await userModel.findById(req.params.id).populate('posts');
    if (!profileUser) return res.status(404).send('User not found');

    let posts = await postModel.find({ user: profileUser._id })
      .populate('user')
      .populate('comments.user')
      .sort({ date: -1 });

    res.render('userprofile', { currentUser, profileUser, posts });
  } catch (error) {
    res.status(500).send('Error loading user profile');
  }
});

// ================= CREATE POST =================
app.post('/post',isLoggedIn,upload.single('image'),async(req,res)=>{
  try {
    let user = await userModel.findOne({email:req.user.email});
    let {content} = req.body;
    let image = req.file ? req.file.filename : null;
    
    if ((!content || content.trim().length === 0) && !image) {
      return res.status(400).send('Post must include text or an image');
    }
    
    let post = await postModel.create({
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

// ================= DELETE POST =================
app.get('/delete/:id',isLoggedIn,async(req,res)=>{
  try {
    let post = await postModel.findOne({_id:req.params.id}).populate("user");
    if(!post) return res.status(404).send('Post not found');
    if(post.user._id.toString() !== req.user.userid.toString()) {
      return res.status(403).send('You can only delete your own posts');
    }
    
    await postModel.findByIdAndDelete(req.params.id);
    await userModel.findByIdAndUpdate(req.user.userid, {$pull: {posts: req.params.id}});
    res.redirect('/profile');
  } catch (error) {
    res.status(500).send('Error deleting post');
  }
});

// ================= LOGOUT =================
app.get('/logout',(req,res)=>{
  let cookieOptions = {
    httpOnly: true,
    sameSite: "None",
    maxAge: 0
  };
  if (process.env.NODE_ENV === 'production') {
    cookieOptions.secure = true;
  }
  res.cookie("token","", cookieOptions);
  res.redirect("/login");
});

// ================= ERROR HANDLER =================
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).send('File size too large. Maximum 5MB allowed.');
  }
  if (err.message.includes('Only image files')) {
    return res.status(400).send(err.message);
  }
  res.status(500).send('Something went wrong on our server');
});

// ================= SERVER START =================
app.listen(process.env.PORT || 3000,()=>{
  console.log("Server is running...");
});
