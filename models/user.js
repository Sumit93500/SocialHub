const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URL || `mongodb://127.0.0.1:27017/miniproject`)
.then(() => console.log("MongoDB connected"))
.catch(err => console.log(err));

const userSchema = mongoose.Schema({
  username:String,
  name:String,
  age:Number,
  email:String,
  password:String,
  profilepic: {
    type: String,
    default:"default.jpg"
  },
  posts: [
    {
      type:mongoose.Schema.Types.ObjectId,ref: 'post'
    }
  ]
})

module.exports=mongoose.model("user",userSchema);