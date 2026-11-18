const report = document.getElementById("tmrs-report-body");
const toggleNavigation = document.getElementById("tmrs-toggle-navigation");
const navigation = document.getElementById("tmrs-navigation-list");
const loading = document.querySelector(".tmrs-loading");

const headers = [];
const queue = [];

function GenerateId() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `tmrs-header-${id}`;
}

function Header(content) {
  const id = GenerateId();
  queue.push(`<h1 id="${id}">${content}</h1>`);
  headers.push({
    id: id,
    content: content,
  });
}
function Text(content) {
  queue.push(`<p>${content}</p>`);
}
function Code(content) {
  queue.push(`<code>${content}</code>`);
}
function Quote(content) {
  queue.push(`<q>${content}</q>`);
}
function Divider() {
  queue.push(`<span class="tmrs-divider"></span>`);
}
function Error(content) {
  queue.push(`<p class="tmrs-error">${content}</p>`);
}
function Spacing() {
  queue.push(`<span class="tmrs-spacing"></span>`);
}

function CreateNavigation() {
  toggleNavigation.style.display = "block";
  navigation.innerHTML = "";
  for (let header of headers) {
    navigation.innerHTML += `<a href="#${header.id}">${header.content}</a>`;
  }
}

function Title(title) {
  document.title = `TMAdmin Remote Service - ${title}`;
}

function Render() {
  const content = queue.join("\n");
  queue.length = 0;
  report.innerHTML = content;
  loading.style.display = "none";
}

function toggleNavigationList() {
  if (navigation.style.display === "none") {
    navigation.style.display = "flex";
  } else {
    navigation.style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  toggleNavigation.addEventListener("click", toggleNavigationList);
  report.addEventListener("click", () => (navigation.style.display = "none"));
});
