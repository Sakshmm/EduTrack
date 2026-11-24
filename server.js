import { createRequire } from "node:module";
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import multer from "multer";
import mammoth from "mammoth";
import "dotenv/config";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* =========================
   DATABASE MODELS
========================= */

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    password: { type: String, required: true },
    role: {
        type: String,
        enum: ["student", "teacher"],
        required: true
    }
}, { timestamps: true });

const assignmentSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, default: "" },
    dueDate: { type: Date, required: true },
    teacherId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    }
}, { timestamps: true });

const submissionSchema = new mongoose.Schema({
    assignmentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Assignment",
        required: true
    },
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    submittedAt: { type: Date, default: Date.now },
    status: {
        type: String,
        enum: ["Submitted", "Late", "Reviewed"],
        default: "Submitted"
    },
    feedback: { type: String, default: "" },
    fileName: { type: String, default: "" },
    filePath: { type: String, default: "" },
    extractedText: { type: String, default: "" }
}, { timestamps: true });

submissionSchema.index(
    { assignmentId: 1, studentId: 1 },
    { unique: true }
);

const focusSessionSchema = new mongoose.Schema({
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    duration: { type: Number, required: true },
    completedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const User = mongoose.model("User", userSchema);
const Assignment = mongoose.model("Assignment", assignmentSchema);
const Submission = mongoose.model("Submission", submissionSchema);
const FocusSession = mongoose.model("FocusSession", focusSessionSchema);

/* =========================
   AUTHENTICATION
========================= */

function createToken(user) {
    return jwt.sign(
        { id: user._id, role: user.role },
        JWT_SECRET,
        { expiresIn: "7d" }
    );
}

function requireAuth(req, res, next) {
    try {
        const token = req.cookies.token;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Please login first."
            });
        }

        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired session."
        });
    }
}

function requireRole(role) {
    return (req, res, next) => {
        if (!req.user || req.user.role !== role) {
            return res.status(403).json({
                success: false,
                message: "Access denied."
            });
        }
        next();
    };
}

/* =========================
   FILE UPLOAD
========================= */

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + "-" +
            Math.round(Math.random() * 1E9);
        cb(null, uniqueName + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = [".pdf", ".docx", ".txt"];
        const extension = path.extname(file.originalname).toLowerCase();

        if (!allowed.includes(extension)) {
            return cb(new Error(
                "Only PDF, DOCX and TXT files are allowed."
            ));
        }

        cb(null, true);
    }
});

async function extractFileText(filePath) {
    const extension = path.extname(filePath).toLowerCase();

    try {
        if (extension === ".pdf") {
            const buffer = fs.readFileSync(filePath);
            const result = await pdfParse(buffer);
            return result.text || "";
        }

        if (extension === ".docx") {
            const result = await mammoth.extractRawText({
                path: filePath
            });
            return result.value || "";
        }

        if (extension === ".txt") {
            return fs.readFileSync(filePath, "utf8");
        }

        return "";
    } catch (error) {
        console.error("Text extraction error:", error.message);
        return "";
    }
}

/* =========================
   SIMILARITY CHECKER
========================= */

function getWords(text) {
    return text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(word => word.length > 2);
}

function similarityScore(text1, text2) {
    const words1 = new Set(getWords(text1));
    const words2 = new Set(getWords(text2));

    if (!words1.size || !words2.size) return 0;

    let common = 0;

    for (const word of words1) {
        if (words2.has(word)) common++;
    }

    const total = new Set([...words1, ...words2]).size;
    return Math.round((common / total) * 100);
}

/* =========================
   DEADLINE RISK PREDICTOR
========================= */

function calculateRisk(assignment, submitted) {
    const now = new Date();
    const dueDate = new Date(assignment.dueDate);
    const hoursLeft = Math.ceil(
        (dueDate - now) / (1000 * 60 * 60)
    );

    if (submitted) {
        return {
            score: 0,
            level: "Completed",
            reason: "Assignment has already been submitted.",
            hoursLeft
        };
    }

    let score;
    let reason;

    if (hoursLeft < 0) {
        score = 100;
        reason = "The deadline has already passed.";
    } else if (hoursLeft <= 24) {
        score = 90;
        reason = "Deadline is less than 24 hours away.";
    } else if (hoursLeft <= 48) {
        score = 70;
        reason = "Deadline is approaching within 2 days.";
    } else if (hoursLeft <= 72) {
        score = 50;
        reason = "Deadline is approaching within 3 days.";
    } else if (hoursLeft <= 168) {
        score = 30;
        reason = "Assignment is due this week.";
    } else {
        score = 10;
        reason = "There is enough time to complete this assignment.";
    }

    const level = score >= 70 ? "High" :
        score >= 40 ? "Medium" : "Low";

    return { score, level, reason, hoursLeft };
}

/* =========================
   LOGIN PAGES
========================= */

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "login.html"));
});

app.get("/login.html", (req, res) => {
    res.sendFile(path.join(__dirname, "login.html"));
});

/* =========================
   LOGIN API
========================= */

app.post("/api/login", async (req, res) => {
    try {
        const { email, password, role } = req.body;

        if (!email || !password || !role) {
            return res.status(400).json({
                success: false,
                message: "Please enter all required fields."
            });
        }

        const user = await User.findOne({
            email: email.toLowerCase().trim()
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        if (user.role !== role) {
            return res.status(401).json({
                success: false,
                message: "Please select the correct role."
            });
        }

        const passwordMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        const token = createToken(user);

        res.cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.json({
            success: true,
            message: "Login successful.",
            role: user.role,
            name: user.name,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({
            success: false,
            message: "Login failed."
        });
    }
});

/* =========================
   CURRENT USER API
========================= */

app.get("/api/me", requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .select("-password");

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }

        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Unable to fetch user."
        });
    }
});

/* =========================
   LOGOUT API
========================= */

app.post("/api/logout", (req, res) => {
    res.clearCookie("token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax"
    });

    res.json({
        success: true,
        message: "Logged out successfully."
    });
});

/* =========================
   CREATE ASSIGNMENT
========================= */

app.post(
    "/api/assignments",
    requireAuth,
    requireRole("teacher"),
    async (req, res) => {
        try {
            const { title, description, dueDate } = req.body;

            if (!title || !dueDate) {
                return res.status(400).json({
                    success: false,
                    message: "Title and due date are required."
                });
            }

            const assignment = await Assignment.create({
                title,
                description,
                dueDate,
                teacherId: req.user.id
            });

            res.status(201).json({
                success: true,
                message: "Assignment created successfully.",
                assignment
            });
        } catch (error) {
            console.error("Create assignment error:", error);
            res.status(500).json({
                success: false,
                message: "Unable to create assignment."
            });
        }
    }
);

/* =========================
   GET ASSIGNMENTS
========================= */

app.get("/api/assignments", requireAuth, async (req, res) => {
    try {
        const filter = req.user.role === "teacher"
            ? { teacherId: req.user.id }
            : {};

        const assignments = await Assignment.find(filter)
            .sort({ dueDate: 1 });

        res.json({
            success: true,
            assignments: assignments.map(item => ({
                id: item._id,
                _id: item._id,
                title: item.title,
                description: item.description,
                dueDate: item.dueDate,
                teacherId: item.teacherId
            }))
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Unable to fetch assignments."
        });
    }
});

/* =========================
   STUDENT SUBMIT ASSIGNMENT
========================= */

app.post(
    "/api/assignments/:id/submit",
    requireAuth,
    requireRole("student"),
    async (req, res) => {
        try {
            const assignment = await Assignment.findById(req.params.id);

            if (!assignment) {
                return res.status(404).json({
                    success: false,
                    message: "Assignment not found."
                });
            }

            const existing = await Submission.findOne({
                assignmentId: assignment._id,
                studentId: req.user.id
            });

            if (existing) {
                return res.status(400).json({
                    success: false,
                    message: "You have already submitted this assignment."
                });
            }

            const status = new Date() > new Date(assignment.dueDate)
                ? "Late" : "Submitted";

            const submission = await Submission.create({
                assignmentId: assignment._id,
                studentId: req.user.id,
                status
            });

            res.status(201).json({
                success: true,
                message: "Assignment submitted successfully.",
                submission
            });
        } catch (error) {
            console.error("Submission error:", error);
            res.status(500).json({
                success: false,
                message: "Unable to submit assignment."
            });
        }
    }
);

/* =========================
   STUDENT FILE UPLOAD
========================= */

app.post(
    "/api/assignments/:id/upload",
    requireAuth,
    requireRole("student"),
    upload.single("assignmentFile"),
    async (req, res) => {
        try {
            const assignment = await Assignment.findById(req.params.id);

            if (!assignment) {
                if (req.file) fs.unlinkSync(req.file.path);

                return res.status(404).json({
                    success: false,
                    message: "Assignment not found."
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: "Please select a file."
                });
            }

            const existing = await Submission.findOne({
                assignmentId: assignment._id,
                studentId: req.user.id
            });

            if (existing) {
                fs.unlinkSync(req.file.path);

                return res.status(400).json({
                    success: false,
                    message: "You have already submitted this assignment."
                });
            }

            const extractedText = await extractFileText(req.file.path);
            const status = new Date() > new Date(assignment.dueDate)
                ? "Late" : "Submitted";

            const submission = await Submission.create({
                assignmentId: assignment._id,
                studentId: req.user.id,
                status,
                fileName: req.file.originalname,
                filePath: req.file.path,
                extractedText
            });

            res.status(201).json({
                success: true,
                message: "File uploaded successfully.",
                submission
            });
        } catch (error) {
            console.error("File upload error:", error);

            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }

            res.status(500).json({
                success: false,
                message: "Unable to upload assignment."
            });
        }
    }
);

/* =========================
   STUDENT OWN SUBMISSIONS
========================= */

app.get(
    "/api/my-submissions",
    requireAuth,
    requireRole("student"),
    async (req, res) => {
        try {
            const submissions = await Submission.find({
                studentId: req.user.id
            }).populate("assignmentId");

            res.json({
                success: true,
                submissions: submissions.map(item => ({
                    id: item._id,
                    assignmentId: item.assignmentId?._id,
                    title: item.assignmentId?.title || "Assignment",
                    submittedAt: item.submittedAt,
                    status: item.status,
                    feedback: item.feedback,
                    fileName: item.fileName
                }))
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: "Unable to fetch submissions."
            });
        }
    }
);

/* =========================
   TEACHER VIEW SUBMISSIONS
========================= */

app.get(
    "/api/assignments/:id/submissions",
    requireAuth,
    requireRole("teacher"),
    async (req, res) => {
        try {
            const assignment = await Assignment.findOne({
                _id: req.params.id,
                teacherId: req.user.id
            });

            if (!assignment) {
                return res.status(404).json({
                    success: false,
                    message: "Assignment not found."
                });
            }

            const submissions = await Submission.find({
                assignmentId: assignment._id
            }).populate("studentId", "name email");

            res.json({
                success: true,
                submissions
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: "Unable to fetch submissions."
            });
        }
    }
);

/* =========================
   TEACHER FEEDBACK
========================= */

app.put(
    "/api/submissions/:id/feedback",
    requireAuth,
    requireRole("teacher"),
    async (req, res) => {
        try {
            const submission = await Submission.findById(
                req.params.id
            ).populate("assignmentId");

            if (!submission || !submission.assignmentId) {
                return res.status(404).json({
                    success: false,
                    message: "Submission not found."
                });
            }

            if (
                submission.assignmentId.teacherId.toString() !==
                req.user.id
            ) {
                return res.status(403).json({
                    success: false,
                    message: "You cannot review this submission."
                });
            }

            submission.feedback = req.body.feedback || "";
            submission.status = "Reviewed";
            await submission.save();

            res.json({
                success: true,
                message: "Feedback saved successfully.",
                submission
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: "Unable to save feedback."
            });
        }
    }
);

/* =========================
   DOWNLOAD SUBMISSION FILE
========================= */

app.get(
    "/api/submissions/:id/download",
    requireAuth,
    async (req, res) => {
        try {
            const submission = await Submission.findById(
                req.params.id
            ).populate("assignmentId");

            if (!submission || !submission.filePath) {
                return res.status(404).json({
                    success: false,
                    message: "File not found."
                });
            }

            if (req.user.role === "student" &&
                submission.studentId.toString() !== req.user.id) {
                return res.status(403).json({
                    success: false,
                    message: "Access denied."
                });
            }

            if (req.user.role === "teacher" &&
                (!submission.assignmentId ||
                submission.assignmentId.teacherId.toString() !== req.user.id)) {
                return res.status(403).json({
                    success: false,
                    message: "Access denied."
                });
            }

            if (!fs.existsSync(submission.filePath)) {
                return res.status(404).json({
                    success: false,
                    message: "File is missing from server."
                });
            }

            res.download(
                submission.filePath,
                submission.fileName || "submission"
            );
        } catch (error) {
            res.status(500).json({
                success: false,
                message: "Unable to download file."
            });
        }
    }
);

/* =========================
   FEATURE 1: DEADLINE RISKS
========================= */

app.get(
    "/api/student/deadline-risks",
    requireAuth,
    requireRole("student"),
    async (req, res) => {
        try {
            const assignments = await Assignment.find()
                .sort({ dueDate: 1 });

            const submissions = await Submission.find({
                studentId: req.user.id
            });

            const submittedIds = new Set(
                submissions.map(item => item.assignmentId.toString())
            );

            const risks = assignments.map(assignment => {
                const submitted = submittedIds.has(
                    assignment._id.toString()
                );

                return {
                    assignmentId: assignment._id,
                    title: assignment.title,
                    dueDate: assignment.dueDate,
                    submitted,
                    ...calculateRisk(assignment, submitted)
                };
            });

            res.json({ success: true, risks });
        } catch (error) {
            console.error("Deadline risk error:", error);
            res.status(500).json({
                success: false,
                message: "Unable to calculate deadline risks."
            });
        }
    }
);

/* =========================
   FEATURE 2: STUDY PLANNER
========================= */

app.post(
    "/api/student/study-plan",
    requireAuth,
    requireRole("student"),
    async (req, res) => {
        try {
            const availableHours = Number(
                req.body.availableHours || 3
            );

            if (
                !Number.isFinite(availableHours) ||
                availableHours <= 0 ||
                availableHours > 16
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Available hours must be between 1 and 16."
                });
            }

            const assignments = await Assignment.find()
                .sort({ dueDate: 1 });

            const submissions = await Submission.find({
                studentId: req.user.id
            });

            const submittedIds = new Set(
                submissions.map(item => item.assignmentId.toString())
            );

            const pending = assignments
                .filter(item => !submittedIds.has(item._id.toString()))
                .map(assignment => ({
                    assignment,
                    risk: calculateRisk(assignment, false)
                }))
                .sort((a, b) => b.risk.score - a.risk.score);

            const plan = [];
            let remainingHours = availableHours;

            for (const item of pending) {
                if (remainingHours <= 0) break;

                const recommended =
                    item.risk.level === "High" ? 2 :
                    item.risk.level === "Medium" ? 1.5 : 1;

                const allocated = Math.min(
                    recommended,
                    remainingHours
                );

                plan.push({
                    assignmentId: item.assignment._id,
                    title: item.assignment.title,
                    dueDate: item.assignment.dueDate,
                    riskLevel: item.risk.level,
                    recommendedHours: allocated,
                    reason: item.risk.reason
                });

                remainingHours -= allocated;
            }

            res.json({
                success: true,
                availableHours,
                plannedHours: availableHours - remainingHours,
                remainingHours,
                plan
            });
        } catch (error) {
            console.error("Study planner error:", error);
            res.status(500).json({
                success: false,
                message: "Unable to generate study plan."
            });
        }
    }
);

/* =========================
   FEATURE 3: TEACHER ANALYTICS
========================= */


app.get(
    "/api/teacher/analytics",
    requireAuth,
    requireRole("teacher"),
    async (req, res) => {
        try {
            const assignments = await Assignment.find({
                teacherId: req.user.id
            });

            const assignmentIds = assignments.map(item => item._id);

            const submissions = await Submission.find({
                assignmentId: { $in: assignmentIds }
            }).populate("studentId", "name email");

            const totalAssignments = assignments.length;
            const totalSubmissions = submissions.length;

            // Count all registered students
            const totalStudents = await User.countDocuments({
                role: "student"
            });

            const pendingSubmissions = Math.max(
                0,
                (totalAssignments * totalStudents) - totalSubmissions
            );

            const completionRate =
                totalAssignments > 0 && totalStudents > 0
                    ? Math.round(
                        (totalSubmissions /
                            (totalAssignments * totalStudents)) * 100
                    )
                    : 0;

            const assignmentStats = assignments.map(assignment => {
                const items = submissions.filter(
                    item =>
                        item.assignmentId.toString() ===
                        assignment._id.toString()
                );

                return {
                    id: assignment._id,
                    title: assignment.title,
                    dueDate: assignment.dueDate,
                    submissionCount: items.length,
                    pendingCount: Math.max(
                        0,
                        totalStudents - items.length
                    ),
                    feedbackCount: items.filter(
                        item => item.feedback?.trim()
                    ).length
                };
            });

            res.json({
                success: true,
                overview: {
                    totalAssignments,
                    totalStudents,
                    totalSubmissions,
                    pendingSubmissions,
                    completionRate
                },
                assignments: assignmentStats
            });

        } catch (error) {
            console.error("Teacher analytics error:", error);

            res.status(500).json({
                success: false,
                message: "Unable to load teacher analytics."
            });
        }
    }
);


/* =========================
   FEATURE 4: FOCUS SESSIONS
========================= */

app.post(
    "/api/student/focus-sessions",
    requireAuth,
    requireRole("student"),
    async (req, res) => {
        try {
            const duration = Number(
                req.body.durationMinutes ?? req.body.duration
            );

            if (
                !Number.isFinite(duration) ||
                duration < 1 ||
                duration > 600
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Duration must be between 1 and 600 minutes."
                });
            }

            const session = await FocusSession.create({
                studentId: req.user.id,
                duration
            });

            res.status(201).json({
                success: true,
                message: "Focus session saved successfully.",
                session
            });
        } catch (error) {
            console.error("Focus session error:", error);
            res.status(500).json({
                success: false,
                message: "Unable to save focus session."
            });
        }
    }
);

app.get(
    "/api/student/productivity",
    requireAuth,
    requireRole("student"),
    async (req, res) => {
        try {
            const sessions = await FocusSession.find({
                studentId: req.user.id
            }).sort({ completedAt: -1 });

            const totalMinutes = sessions.reduce(
                (sum, item) => sum + item.duration, 0
            );

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const weekStart = new Date();
            weekStart.setDate(weekStart.getDate() - 6);
            weekStart.setHours(0, 0, 0, 0);

            const todaySessions = sessions.filter(
                item => new Date(item.completedAt) >= today
            );

            const weeklySessions = sessions.filter(
                item => new Date(item.completedAt) >= weekStart
            );

            const todayMinutes = todaySessions.reduce(
                (sum, item) => sum + item.duration, 0
            );

            const weeklyMinutes = weeklySessions.reduce(
                (sum, item) => sum + item.duration, 0
            );

            const daily = [];

            for (let i = 6; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                date.setHours(0, 0, 0, 0);

                const nextDate = new Date(date);
                nextDate.setDate(nextDate.getDate() + 1);

                const minutes = sessions
                    .filter(item => {
                        const completed = new Date(item.completedAt);
                        return completed >= date && completed < nextDate;
                    })
                    .reduce((sum, item) => sum + item.duration, 0);

                daily.push({
                    date: date.toISOString().slice(0, 10),
                    minutes
                });
            }

            res.json({
                success: true,
                overview: {
                    todayMinutes,
                    weekMinutes: weeklyMinutes,
                    totalMinutes,
                    totalSessions: sessions.length
                },
                totalSessions: sessions.length,
                totalMinutes,
                todaySessions: todaySessions.length,
                todayMinutes,
                weeklySessions: weeklySessions.length,
                weeklyMinutes,
                averageSessionMinutes: sessions.length
                    ? Math.round(totalMinutes / sessions.length)
                    : 0,
                daily
            });
        } catch (error) {
            console.error("Productivity error:", error);
            res.status(500).json({
                success: false,
                message: "Unable to fetch productivity data."
            });
        }
    }
);

/* =========================
   FEATURE 5: SIMILARITY CHECKER
========================= */

app.get(
    "/api/assignments/:id/similarity",
    requireAuth,
    requireRole("teacher"),
    async (req, res) => {
        try {
            const assignment = await Assignment.findOne({
                _id: req.params.id,
                teacherId: req.user.id
            });

            if (!assignment) {
                return res.status(404).json({
                    success: false,
                    message: "Assignment not found."
                });
            }

            const submissions = await Submission.find({
                assignmentId: assignment._id,
                extractedText: { $ne: "" }
            }).populate("studentId", "name email");

            const comparisons = [];

            for (let i = 0; i < submissions.length; i++) {
                for (let j = i + 1; j < submissions.length; j++) {
                    const first = submissions[i];
                    const second = submissions[j];

                    const score = similarityScore(
                        first.extractedText,
                        second.extractedText
                    );

                    comparisons.push({
                        studentOne: {
                            id: first.studentId?._id,
                            name: first.studentId?.name || "Unknown"
                        },
                        studentTwo: {
                            id: second.studentId?._id,
                            name: second.studentId?.name || "Unknown"
                        },
                        similarityPercentage: score,
                        level: score >= 70 ? "High" :
                            score >= 40 ? "Medium" : "Low"
                    });
                }
            }

            comparisons.sort(
                (a, b) => b.similarityPercentage - a.similarityPercentage
            );

            res.json({
                success: true,
                assignmentTitle: assignment.title,
                totalSubmissions: submissions.length,
                comparisons
            });
        } catch (error) {
            console.error("Similarity checker error:", error);
            res.status(500).json({
                success: false,
                message: "Unable to check submission similarity."
            });
        }
    }
);

/* =========================
   PROTECTED DASHBOARD PAGES
========================= */

app.get(
    "/student.html",
    requireAuth,
    requireRole("student"),
    (req, res) => {
        res.sendFile(path.join(__dirname, "student.html"));
    }
);

app.get(
    "/teacher.html",
    requireAuth,
    requireRole("teacher"),
    (req, res) => {
        res.sendFile(path.join(__dirname, "teacher.html"));
    }
);

/* =========================
   STATIC FILES
   Keep private HTML files protected.
========================= */

app.use(express.static(__dirname, {
    index: false,
    dotfiles: "deny",
    setHeaders: (res, filePath) => {
        const name = path.basename(filePath).toLowerCase();

        if ([
            "student.html",
            "teacher.html",
            "login.html",
            "server.js",
            "package.json",
            ".env"
        ].includes(name)) {
            res.status(403);
        }
    }
}));

/* =========================
   ERROR HANDLER
========================= */

app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({
                success: false,
                message: "File size cannot exceed 10 MB."
            });
        }

        return res.status(400).json({
            success: false,
            message: error.message
        });
    }

    if (error) {
        return res.status(400).json({
            success: false,
            message: error.message || "Something went wrong."
        });
    }

    next();
});

/* =========================
   START SERVER
========================= */

async function startServer() {
    try {
        if (!JWT_SECRET) {
            throw new Error("JWT_SECRET is missing in .env file.");
        }

        if (!process.env.MONGODB_URI) {
            throw new Error("MONGODB_URI is missing in .env file.");
        }

        await mongoose.connect(process.env.MONGODB_URI, {
            autoSelectFamily: false,
            serverSelectionTimeoutMS: 15000,
            connectTimeoutMS: 10000
        });

        console.log("MongoDB connected successfully.");

        app.listen(PORT, () => {
            console.log(
                `EduTrack running at http://localhost:${PORT}`
            );
        });
    } catch (error) {
        console.error("Server startup failed:", error.message);
        process.exit(1);
    }
}

startServer();