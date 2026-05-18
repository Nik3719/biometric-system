let currentPage = 1;
let searchQuery = '';

// Инкапсулированная функция вывода системных нотификаций (Toasts) [cite: 54]
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 4000);
}

// Клиентский роутер (SPA архитектура) [cite: 43]
function clientRouter() {
    const hash = window.location.hash || '#login';
    const token = localStorage.getItem('token');

    // Защита приватных путей панели управления (Дашборда) [cite: 48]
    if (hash === '#dashboard' && !token) {
        window.location.hash = '#login';
        return;
    }

    // Скрываем все зарегистрированные представления
    document.querySelectorAll('.view').forEach(view => view.classList.add('hidden'));
    document.getElementById('main-nav').classList.add('hidden');

    // Настройка интерфейса под авторизованную сессию [cite: 47]
    if (token) {
        document.getElementById('main-nav').classList.remove('hidden');
        document.getElementById('user-display').innerText = `Сотрудник: ${localStorage.getItem('username')}`;
    }

    // Переключение экранов отображения
    if (hash === '#login') document.getElementById('view-login').classList.remove('hidden');
    if (hash === '#register') document.getElementById('view-register').classList.remove('hidden');
    if (hash === '#dashboard' && token) {
        document.getElementById('view-dashboard').classList.remove('hidden');
        loadPersonsRegistry(); // Загрузка данных таблицы при переключении
    }
}

window.addEventListener('hashchange', clientRouter);
window.addEventListener('DOMContentLoaded', clientRouter);

// Общая обертка для отправки AJAX/Fetch запросов с JWT авторизацией [cite: 44, 98]
async function apiFetch(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    options.headers = {
        ...options.headers,
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}) // Передача токена в заголовке [cite: 98]
    };

    const response = await fetch(endpoint, options);
    
    // Перехват 401/403 ошибок и сброс сессии [cite: 55]
    if (response.status === 401 || response.status === 403) {
        localStorage.clear();
        window.location.hash = '#login';
        showToast('Сессия не авторизована или срок действия JWT истек.', 'error');
        throw new Error('Unauthorized Access Intercepted');
    }

    const json = await response.json();
    if (!response.ok) throw new Error(json.error || 'Произошла непредвиденная ошибка API.');
    return json;
}

// --- ФУНКЦИИ ВЗАИМОДЕЙСТВИЯ С API ---

async function login() {
    const usernameInput = document.getElementById('login-username').value;
    const passwordInput = document.getElementById('login-password').value;
    try {
        const data = await apiFetch('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username: usernameInput, password: passwordInput })
        });
        localStorage.setItem('token', data.token);
        localStorage.setItem('username', data.user.username);
        showToast('Вход в систему успешно выполнен.');
        window.location.hash = '#dashboard';
    } catch (err) {
        showToast(err.message, 'error'); // [cite: 54]
    }
}

async function register() {
    const usernameInput = document.getElementById('reg-username').value;
    const emailInput = document.getElementById('reg-email').value;
    const passwordInput = document.getElementById('reg-password').value;
    try {
        await apiFetch('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username: usernameInput, email: emailInput, password: passwordInput })
        });
        showToast('Регистрация успешна. Вы можете авторизоваться.');
        window.location.hash = '#login';
    } catch (err) {
        showToast(err.message, 'error'); // [cite: 54]
    }
}

function logout() {
    localStorage.clear();
    window.location.hash = '#login';
    showToast('Вы вышли из учетной записи.');
}

// Получение реестра субъектов с сервера и рендеринг таблицы [cite: 14, 50]
async function loadPersonsRegistry() {
    try {
        const response = await apiFetch(`/api/persons?page=${currentPage}&search=${searchQuery}`);
        const tbody = document.getElementById('persons-table-body');
        tbody.innerHTML = '';

        response.data.forEach(person => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><b>${person.first_name}</b></td>
                <td>${person.last_name}</td>
                <td><code>${person.national_id}</code></td>
                <td style="text-align: right; display: flex; gap: 8px; justify-content: flex-end;">
                    <button style="width:auto; background:var(--success); padding: 6px 10px;" onclick="uploadBiometricPrompt('${person.id}')">+ Биометрия</button>
                    <button style="width:auto; background:var(--danger); padding: 6px 10px;" onclick="deletePerson('${person.id}')">Удалить</button>
                </td>
            `;
            tbody.appendChild(row);
        });

        // Обновление состояния элементов пагинации [cite: 52]
        document.getElementById('page-info').innerText = `Страница ${response.page} из ${response.pages || 1}`;
        document.getElementById('prev-btn').disabled = (response.page <= 1);
        document.getElementById('next-btn').disabled = (response.page >= response.pages);
    } catch (err) {
        console.error('Ошибка рендеринга реестра:', err.message);
    }
}

async function addPerson() {
    const first_name = document.getElementById('p-first').value;
    const last_name = document.getElementById('p-last').value;
    const national_id = document.getElementById('p-national').value;

    try {
        await apiFetch('/api/persons', {
            method: 'POST',
            body: JSON.stringify({ first_name, last_name, national_id })
        });
        showToast('Данные субъекта успешно внесены.');
        // Очистка формы
        document.getElementById('p-first').value = '';
        document.getElementById('p-last').value = '';
        document.getElementById('p-national').value = '';
        loadPersonsRegistry();
    } catch (err) {
        showToast(err.message, 'error'); // [cite: 54]
    }
}

async function deletePerson(id) {
    if (!confirm('Вы уверены, что хотите удалить субъекта? Все связанные биометрические файлы будут уничтожены каскадно.')) return;
    try {
        await apiFetch(`/api/persons/${id}`, { method: 'DELETE' });
        showToast('Запись субъекта удалена из системы.');
        loadPersonsRegistry();
    } catch (err) {
        showToast(err.message, 'error'); // [cite: 54]
    }
}

// Функции фильтрации и пагинации [cite: 52]
function searchPersons() {
    searchQuery = document.getElementById('search-input').value;
    currentPage = 1; // Сбрасываем на первую страницу при поиске
    loadPersonsRegistry();
}

function changePage(direction) {
    currentPage += direction;
    loadPersonsRegistry();
}

// Эмуляция загрузки архива биометрии (Вставка закодированной Base64 строки)
async function uploadBiometricPrompt(personId) {
    const base64Input = prompt("Вставьте закодированную биометрическую запись в формате Base64 текстовой строки:");
    if (!base64Input) return;

    try {
        await apiFetch('/api/biometrics', {
            method: 'POST',
            body: JSON.stringify({
                person_id: personId,
                type_id: 1, // По умолчанию 1 (каркас сущности face_id в справочнике типов)
                image_base64: base64Input
            })
        });
        showToast('Биометрическая запись успешно привязана к субъекту.');
    } catch (err) {
        showToast(err.message, 'error'); // [cite: 54]
    }
}