
import {
    fetchQuote,
    fetchQuoteWithPromise
} from "./api.js";

// HTML elements
const taskInput = document.getElementById("taskInput");
const taskForm = document.getElementById("taskForm");
const taskList = document.getElementById("taskList");
const searchInput = document.getElementById("searchInput");
const taskFilter = document.getElementById("taskFilter");
const emptyMessage = document.getElementById("emptyMessage");

const totalTasks = document.getElementById("totalTasks");
const completedTasks = document.getElementById("completedTasks");
const pendingTasks = document.getElementById("pendingTasks");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");

const quoteElement = document.getElementById("quote");
const quoteBtn = document.getElementById("quoteBtn");

// Load saved tasks
let tasks = JSON.parse(
    localStorage.getItem("studyflowTasks")
) || [];

// Save tasks in Local Storage
function saveTasks() {
    localStorage.setItem(
        "studyflowTasks",
        JSON.stringify(tasks)
    );
}

// Update dashboard statistics
function updateDashboard() {
    const completed = tasks.filter(task => task.completed).length;
    const pending = tasks.length - completed;

    const percentage = tasks.length
        ? Math.round((completed / tasks.length) * 100)
        : 0;

    totalTasks.textContent = tasks.length;
    completedTasks.textContent = completed;
    pendingTasks.textContent = pending;

    progressBar.style.width = percentage + "%";
    progressText.textContent = percentage + "% completed";
}

// Display tasks with search and filters
function renderTasks() {
    taskList.innerHTML = "";

    const searchText = searchInput.value.toLowerCase().trim();
    const filterValue = taskFilter.value;

    const filteredTasks = tasks.filter(task => {
        const matchesSearch = task.text
            .toLowerCase()
            .includes(searchText);

        const matchesFilter =
            filterValue === "all" ||
            (filterValue === "completed" && task.completed) ||
            (filterValue === "pending" && !task.completed);

        return matchesSearch && matchesFilter;
    });

    filteredTasks.forEach(task => {
        const li = document.createElement("li");
        const taskName = document.createElement("span");
        const completeBtn = document.createElement("button");
        const deleteBtn = document.createElement("button");

        taskName.textContent = task.text;

        if (task.completed) {
            taskName.style.textDecoration = "line-through";
            taskName.style.color = "gray";
        }

        completeBtn.textContent = task.completed ? "Undo" : "Complete";
        deleteBtn.textContent = "Delete";

        completeBtn.addEventListener("click", () => {
            task.completed = !task.completed;
            saveTasks();
            renderTasks();
        });

        deleteBtn.addEventListener("click", () => {
            tasks = tasks.filter(item => item.id !== task.id);
            saveTasks();
            renderTasks();
        });

        li.append(taskName, completeBtn, deleteBtn);
        taskList.appendChild(li);
    });

    emptyMessage.style.display =
        filteredTasks.length ? "none" : "block";

    updateDashboard();
}

// Add a new task
function addTask(event) {
    event.preventDefault();

    const taskText = taskInput.value.trim();

    if (!taskText) {
        taskInput.focus();
        return;
    }

    tasks.push({
        id: Date.now(),
        text: taskText,
        completed: false
    });

    saveTasks();

    taskInput.value = "";
    searchInput.value = "";
    taskFilter.value = "all";

    renderTasks();
    taskInput.focus();
}

// Event listeners
taskForm.addEventListener("submit", addTask);
searchInput.addEventListener("input", renderTasks);
taskFilter.addEventListener("change", renderTasks);

// API with async/await
async function getQuote() {
    quoteElement.textContent = "Loading your inspiration...";
    quoteBtn.disabled = true;

    try {
        const data = await fetchQuote();

        quoteElement.textContent =
            `"${data.quote}" — ${data.author}`;
    } catch (error) {
        quoteElement.textContent =
            "Unable to load a quote. Please try again.";

        console.error("Quote error:", error);
    } finally {
        quoteBtn.disabled = false;
    }
}

// API with Promises: then, catch and finally
function testPromiseFlow() {
    quoteElement.textContent = "Loading your inspiration...";
    quoteBtn.disabled = true;

    fetchQuoteWithPromise()
        .then(data => {
            quoteElement.textContent =
                `"${data.quote}" — ${data.author}`;

            console.log("Promise successful:", data);
        })
        .catch(error => {
            quoteElement.textContent =
                "Unable to load a quote. Please try again.";

            console.error("Promise failed:", error);
        })
        .finally(() => {
            quoteBtn.disabled = false;
        });
}

// Main quote button uses async/await
quoteBtn.addEventListener("click", getQuote);

// Initial dashboard render
renderTasks();
