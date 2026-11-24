
"use strict";

const loginForm = document.getElementById("loginForm");
const loginMessage = document.getElementById("loginMessage");
const loginButton = document.getElementById("loginButton");
const roleOptions = document.querySelectorAll(".role-option");

// Role selection styling
roleOptions.forEach((option) => {
    option.addEventListener("change", () => {
        roleOptions.forEach((item) => {
            const radio = item.querySelector('input[name="role"]');
            item.classList.toggle("selected", radio.checked);
        });
    });
});

// Login form
loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    loginMessage.textContent = "";
    loginMessage.className = "";

    const formData = new FormData(loginForm);

    const credentials = {
        role: formData.get("role"),
        email: (formData.get("email") || "").trim(),
        password: formData.get("password") || ""
    };

    if (!credentials.email || !credentials.password) {
        loginMessage.textContent = "Enter your email and password.";
        return;
    }

    loginButton.disabled = true;
    loginButton.textContent = "Signing in...";

    try {
        const response = await fetch("/api/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            credentials: "same-origin",
            body: JSON.stringify(credentials)
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.message || "Login failed.");
        }

        // Support both common backend response formats
        const accountRole =
            data.role ||
            data.user?.role ||
            credentials.role;

        if (accountRole !== credentials.role) {
            throw new Error("Selected role does not match your account.");
        }

        loginMessage.textContent = "Login successful. Redirecting...";
        loginMessage.className = "success";

        // Redirect according to account role
        if (accountRole === "student") {
            window.location.replace("/student.html");
        } else if (accountRole === "teacher") {
            window.location.replace("/teacher.html");
        } else {
            throw new Error("Account role could not be verified.");
        }

    } catch (error) {
        loginMessage.textContent =
            error.message === "Failed to fetch"
                ? "Cannot reach the server. Make sure EduTrack is running."
                : error.message || "Unable to sign in.";

        loginButton.disabled = false;
        loginButton.innerHTML = 'Sign In <span aria-hidden="true">→</span>';
    }
});
