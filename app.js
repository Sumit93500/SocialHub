const express = require('express');
const app = express();
const userModel = require("./models/user");
const postModel = require("./models/post");
const path = require('path');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const jwt = require("jsonwebtoken");
const crypto = require('crypto');
const upload = require('./config/multerconfig');
const validator = require('validator');
require('dotenv').config();

app.set('view engine','ejs');
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,'public')));
app.use(cookieParser());

app.get('/',(req,res)=>{            
  res.render("index");
});

app.get('/profile/upload',(req,res)=>{            
  res.render("profileupload");
});

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


app.get("/like/:id",isLoggedIn,async(req,res)=>{
  let post = await postModel.findOne({_id:req.params.id}).populate("user");

  if(post.likes.indexOf(req.user.userid)=== -1)
  {
     post.likes.push(req.user.userid);
  }
  else{
    post.likes.splice(post.likes.indexOf(req.user.userid),1);
  }
 
   await post.save();
  res.redirect("/profile");
})

app.get("/edit/:id",isLoggedIn,async(req,res)=>{
  let post = await postModel.findOne({_id:req.params.id}).populate("user");
  res.render("edit",{post});
})

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
    
    let updatedPost = await postModel.findOneAndUpdate({_id:req.params.id},{content: content});
    res.redirect("/profile");
  } catch (error) {
    res.status(500).send('Error updating post');
  }
})

app.post('/register',async(req,res)=>{
  try {
    let {email,password,username,name,age}=req.body;
    
    // Input validation
    if (!email || !password || !username || !name || !age) {
      return res.status(400).send('All fields are required');
    }
    if (!validator.isEmail(email)) {
      return res.status(400).send('Invalid email format');
    }
    if (password.length < 6) {
      return res.status(400).send('Password must be at least 6 characters');
    }
    if (!validator.isInt(age.toString()) || age < 13) {
      return res.status(400).send('Age must be at least 13');
    }
    
    let user = await userModel.findOne({email});
    if(user) return res.status(400).send('User already registered');

    bcrypt.genSalt(10,(err,salt)=>{
      bcrypt.hash(password,salt,async(err,hash)=>{
        if(err) return res.status(500).send('Error registering user');
        
        let user = await userModel.create({
          username,
          email,
          age,
          name,
          password:hash
        });

       let token =  jwt.sign({email:email, userid:user._id}, process.env.JWT_SECRET);
       res.cookie('token',token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
       res.send("registered");
      })  
    })
  } catch (error) {
    res.status(500).send('Error during registration');
  }
})

app.get('/login',(req,res,next)=>{
  res.render('login');
})

app.get('/profile',isLoggedIn,async(req,res)=>{
 let user =  await userModel.findOne({email:req.user.email}).populate("posts");
  res.render('profile',{user});
})

app.post('/post',isLoggedIn,async(req,res)=>{
 let user =  await userModel.findOne({email:req.user.email});
 let {content} = req.body;
 
 if (!content || content.trim().length === 0) {
   return res.status(400).send('Post content cannot be empty');
 }
 
 let post = await postModel.create({
  user:user._id,
  content
 });
 user.posts.push(post._id);
 await user.save();
 res.redirect('/profile');
})

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
})

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

    bcrypt.compare(password,user.password,(err,result)=>{
      if(result) {
       let token =  jwt.sign({email:email, userid:user._id}, process.env.JWT_SECRET);
       res.cookie('token',token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
       res.status(200).redirect("/profile");
      }
      else res.status(401).send('Invalid email or password');
    })
  } catch (error) {
    res.status(500).send('Error during login');
  }
})

app.get('/logout',(req,res)=>{
  res.cookie("token","");
  res.redirect("/login");
})

function isLoggedIn(req,res,next){
  if(req.cookies.token ==="") res.redirect('/login');
  else{
    try {
      let data = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
      req.user = data;
      next();
    } catch (error) {
      res.cookie('token', '', { maxAge: 0 });
      res.redirect('/login');
    }
  }
  
}

// Error handling middleware
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

app.listen(process.env.PORT || 3000,(req,res)=>{
  console.log("Server is running at http://localhost:" + (process.env.PORT || 3000));
})