
import mongoose from "mongoose";
//import bcrypt from "bcryptjs";
import bcrypt from "bcrypt";
import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rl = readline.createInterface({ input, output });

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
            maxlength: 254
        },
        password: {
            type: String,
            required: true,
            select: false
        },
        role: {
            type: String,
            enum: ["student", "teacher"],
            required: true
        }
    },
    { timestamps: true }
);

const User =
    mongoose.models.User || mongoose.model("User", userSchema);

async function createUser() {
    try {
        // 1. Check environment configuration
        if (!process.env.MONGODB_URI) {
            throw new Error(
                "MONGODB_URI missing in .env file."
            );
        }

        console.log("Connecting to MongoDB Atlas...");

        // 2. Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI, {
            autoSelectFamily: false,
            serverSelectionTimeoutMS: 10000,
            connectTimeoutMS: 10000,
            socketTimeoutMS: 20000
        });

        console.log("MongoDB connected successfully.");

        // 3. Get account details
        const name = (
            await rl.question("Full name: ")
        ).trim();

        const email = (
            await rl.question("Email/account ID: ")
        ).trim().toLowerCase();

        const password = await rl.question("Create password: ");

        const role = (
            await rl.question("Role (student/teacher): ")
        ).trim().toLowerCase();

        // 4. Validate input
        if (!name || name.length > 100) {
            throw new Error(
                "Enter a valid name (maximum 100 characters)."
            );
        }

        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailPattern.test(email) || email.length > 254) {
            throw new Error("Enter a valid email address.");
        }

        if (password.length < 8 || password.length > 128) {
            throw new Error(
                "Password must contain between 8 and 128 characters."
            );
        }

        if (!["student", "teacher"].includes(role)) {
            throw new Error(
                "Role must be student or teacher."
            );
        }

        // 5. Check for existing account
        const existingUser = await User.findOne({ email })
            .select("_id")
            .lean();

        if (existingUser) {
            throw new Error(
                "This email/account ID already exists. Use another email."
            );
        }

        // 6. Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // 7. Create account
        await User.create({
            name,
            email,
            password: hashedPassword,
            role
        });

        console.log(`\nCreated ${role} account successfully.`);
        console.log(`Account email: ${email}`);
        console.log("You can now try signing in.");

    } catch (error) {
        console.error("\nCould not create account.");

        if (error.code === 11000) {
            console.error("This email/account ID already exists.");
        } else if (error.name === "MongooseServerSelectionError") {
            console.error(
                "MongoDB server could not be reached."
            );
            console.error("Check Atlas cluster and IP access settings.");
        } else {
            console.error("Reason:", error.message);
        }

        process.exitCode = 1;

    } finally {
        rl.close();

        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect().catch(() => {});
        }
    }
}

createUser();
