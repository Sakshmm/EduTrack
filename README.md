
# EduTrack – Student & Teacher Management System

## About the Project
EduTrack is a web-based academic management system designed to help students and teachers manage assignments, submissions, feedback, and study productivity in one place.

## Features

### Student
- Student Login
- View Assignments
- Submit Assignments (PDF, DOCX, TXT)
- Track Submission Status
- View Teacher Feedback
- Deadline Risk Prediction
- Smart Study Planner
- Focus Timer
- Productivity Tracking

### Teacher
- Teacher Login
- Create Assignments
- View Student Submissions
- Download Submitted Files
- Provide Feedback
- View Analytics
- Similarity Checker

## Technologies Used

- HTML
- CSS
- JavaScript
- Node.js
- Express.js
- MongoDB
- Mongoose
- JWT Authentication
- Multer
- Mammoth

## Project Structure

```text
StudyFlow/
├── uploads/
├── .env
├── api.js
├── app.js
├── create-user.js
├── index.html
├── login.css
├── login.html
├── login.js
├── package.json
├── package-lock.json
├── server.js
├── student.html
├── style.css
├── teacher.html
└── README.md
```

## Installation and Setup

### 1. Clone the Repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
```

### 2. Open the Project Folder

```bash
cd StudyFlow
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env` file and add your configuration:

```env
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_secret_key
PORT=5000
```

Use your actual MongoDB connection string and a secure JWT secret.

### 5. Start the Server

```bash
node server.js
```

### 6. Open the Application

Open the local URL configured by your server in the browser.

## Future Improvements

- Improved recommendation system
- Advanced student performance analytics
- Enhanced assignment similarity detection
- Better mobile responsiveness

## Author

Developed as an academic project.
