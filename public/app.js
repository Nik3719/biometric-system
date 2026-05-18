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
    if ((hash === '#dashboard' || hash.startsWith('#biometric-detail')) && !token) {
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
    if (hash.startsWith('#biometric-detail') && token) {
        document.getElementById('view-biometric-detail').classList.remove('hidden');
    }
}

window.addEventListener('hashchange', clientRouter);
window.addEventListener('DOMContentLoaded', clientRouter);

// Общая обертка для отправки AJAX/Fetch запросов с JWT авторизацией
async function apiFetch(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    options.headers = {
        ...options.headers,
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };

    const response = await fetch(endpoint, options);
    
    // ИСПРАВЛЕНО: Сбрасываем сессию только если это 401/403 И это НЕ запрос на вход (login)
    if ((response.status === 401 || response.status === 403) && !endpoint.includes('/api/auth/login')) {
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
                    <button style="width:auto; background:#6b7280; padding: 6px 10px;" onclick="openEditPersonModal('${person.id}', '${person.first_name}', '${person.last_name}', '${person.national_id}')">Редактировать</button>
                    <button style="width:auto; background:var(--success); padding: 6px 10px;" onclick="openBioModal('${person.id}', '${person.first_name}', '${person.last_name}')">Биометрия</button>
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

// --- ФУНКЦИИ РЕДАКТИРОВАНИЯ СУБЪЕКТА ---

function openEditPersonModal(id, firstName, lastName, nationalId) {
    document.getElementById('edit-person-id').value = id;
    document.getElementById('edit-first-name').value = firstName;
    document.getElementById('edit-last-name').value = lastName;
    document.getElementById('edit-national-id').value = nationalId;
    document.getElementById('edit-modal').classList.remove('hidden');
}

function closeEditModal() {
    document.getElementById('edit-modal').classList.add('hidden');
    document.getElementById('edit-person-id').value = '';
    document.getElementById('edit-first-name').value = '';
    document.getElementById('edit-last-name').value = '';
    document.getElementById('edit-national-id').value = '';
}

async function saveEditPerson() {
    const id = document.getElementById('edit-person-id').value;
    const first_name = document.getElementById('edit-first-name').value;
    const last_name = document.getElementById('edit-last-name').value;
    const national_id = document.getElementById('edit-national-id').value;

    if (!first_name || !last_name) {
        showToast('Имя и фамилия не могут быть пустыми.', 'error');
        return;
    }

    try {
        await apiFetch(`/api/persons/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ first_name, last_name, national_id })
        });
        showToast('Данные субъекта успешно обновлены.');
        closeEditModal();
        loadPersonsRegistry();
    } catch (err) {
        showToast(err.message, 'error');
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

// Переменные состояния модального окна биометрии
let currentModalPersonId = null;
let currentFileBase64Data = null;

// Переменные состояния для страницы деталей биометрии
let currentDetailBiometricRecord = null;
let currentDetailPersonId = null;

// 1. Открытие профиля биометрии
async function openBioModal(personId, firstName, lastName) {
    currentModalPersonId = personId;
    document.getElementById('modal-title').innerText = `Биометрия: ${firstName} ${lastName}`;
    
    // Сохраняем имя и фамилию для использования при возврате со страницы деталей
    localStorage.setItem('current-person-first-name', firstName);
    localStorage.setItem('current-person-last-name', lastName);
    
    // Сброс полей формы загрузки
    currentFileBase64Data = null;
    document.getElementById('file-preview-container').classList.add('hidden');
    document.getElementById('bio-file-input').value = '';
    
    // Показываем модалку на экране
    document.getElementById('bio-modal').classList.remove('hidden');
    
    // Подгружаем снимки из базы данных
    await fetchAndRenderBiometrics(personId);
}

function closeBioModal() {
    document.getElementById('bio-modal').classList.add('hidden');
    currentModalPersonId = null;
    currentFileBase64Data = null;
}

// 2. FileReader API: Конвертация выбранного файла (.BMP из SOCOFing) в строку Base64
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        // e.target.result содержит готовую Data-URL строку: "data:image/bmp;base64,iVBORw..."
        currentFileBase64Data = e.target.result;
        
        // Выводим превью картинки в интерфейс
        document.getElementById('file-preview').src = currentFileBase64Data;
        document.getElementById('file-preview-container').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

// 3. Отправка Base64 строки снимка на сервер в PostgreSQL
async function uploadBiometricData() {
    if (!currentModalPersonId || !currentFileBase64Data) return;
    const typeId = parseInt(document.getElementById('bio-type-select').value);

    try {
        await apiFetch('/api/biometrics', {
            method: 'POST',
            body: JSON.stringify({
                person_id: currentModalPersonId,
                type_id: typeId,
                image_base64: currentFileBase64Data
            })
        });
        showToast('Биометрический снимок успешно импортирован и защищен хэшем.');
        
        // Очищаем форму импорта
        document.getElementById('file-preview-container').classList.add('hidden');
        document.getElementById('bio-file-input').value = '';
        currentFileBase64Data = null;
        
        // Обновляем сетку картинок
        await fetchAndRenderBiometrics(currentModalPersonId);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// 4. Запрос картинок из БД и их отображение в HTML
async function fetchAndRenderBiometrics(personId) {
    const grid = document.getElementById('bio-records-list');
    grid.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Загрузка архива СУБД...</p>';
    
    try {
        const records = await apiFetch(`/api/biometrics/${personId}`);
        grid.innerHTML = '';
        
        if (records.length === 0) {
            grid.innerHTML = '<p style="color:var(--text-muted); font-size:13px; grid-column: 1/-1; text-align:center; padding:15px;">В базе данных нет снимков для этого субъекта.</p>';
            return;
        }
        
        records.forEach(rec => {
            const item = document.createElement('div');
            item.className = 'bio-item';
            
            // Если строка в базе уже содержит заголовок data:, используем её, иначе подставляем bmp по умолчанию
            const imgSrc = rec.image_base64.startsWith('data:') ? rec.image_base64 : `data:image/bmp;base64,${rec.image_base64}`;
            
            item.innerHTML = `
                <img src="${imgSrc}" alt="${rec.type_name}">
                <div class="bio-meta"><b>${rec.type_name}</b></div>
                <div class="bio-meta" title="Хэш: ${rec.hash_sum}">CRC: <code>${rec.hash_sum.substring(0, 8)}</code></div>
                <button class="btn-bio-delete" onclick="deleteBiometricRecord('${rec.id}')">Удалить</button>
            `;
            
            // Добавляем обработчик клика на весь элемент для открытия деталей
            item.addEventListener('click', (e) => {
                // Если клик НЕ на кнопку удаления, открываем деталь
                if (!e.target.classList.contains('btn-bio-delete')) {
                    viewBiometricDetail(rec);
                }
            });
            
            grid.appendChild(item);
        });
    } catch (err) {
        grid.innerHTML = `<p style="color:var(--danger); font-size:13px;">Ошибка архива: ${err.message}</p>`;
    }
}

// 5. Удаление снимка
async function deleteBiometricRecord(recordId) {
    if (!confirm('Удалить этот снимок из базы данных? Операция будет записана в журнал системного аудита.')) return;
    try {
        await apiFetch(`/api/biometrics/${recordId}`, { method: 'DELETE' });
        showToast('Запись биометрии удалена.');
        if (currentModalPersonId) {
            await fetchAndRenderBiometrics(currentModalPersonId);
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// --- ФУНКЦИИ ДЛЯ СТРАНИЦЫ ПРОСМОТРА ДЕТАЛЕЙ БИОМЕТРИИ ---

// Открытие страницы просмотра деталей конкретной биометрии
function viewBiometricDetail(record) {
    currentDetailBiometricRecord = record;
    currentDetailPersonId = currentModalPersonId;
    
    // Закрываем модальное окно
    closeBioModal();
    
    // Заполняем данные на странице деталей
    document.getElementById('detail-type-name').innerText = record.type_name;
    
    // Форматируем дату
    const capturedDate = new Date(record.captured_at).toLocaleString('ru-RU');
    document.getElementById('detail-captured-at').innerText = capturedDate;
    
    // Отображаем хеш
    document.getElementById('detail-hash-sum').innerText = record.hash_sum;
    
    // Отображаем изображение
    const imgSrc = record.image_base64.startsWith('data:') ? record.image_base64 : `data:image/bmp;base64,${record.image_base64}`;
    document.getElementById('detail-bio-image').src = imgSrc;
    
    // Переходим на страницу деталей
    window.location.hash = `#biometric-detail/${record.id}`;
}

// Возврат назад в модальное окно биометрии
function backToBioModal() {
    currentDetailBiometricRecord = null;
    window.location.hash = '#dashboard';
    
    // Небольшая задержка перед открытием модала, чтобы clientRouter отработал
    setTimeout(() => {
        if (currentModalPersonId) {
            openBioModal(currentModalPersonId, localStorage.getItem('current-person-first-name') || '', localStorage.getItem('current-person-last-name') || '');
        }
    }, 100);
}

// Скачивание биометрического изображения
function downloadBiometric() {
    if (!currentDetailBiometricRecord) return;
    
    const record = currentDetailBiometricRecord;
    const link = document.createElement('a');
    
    // Если это уже data URL, используем его, иначе конвертируем
    let dataUrl = record.image_base64;
    if (!dataUrl.startsWith('data:')) {
        dataUrl = `data:image/bmp;base64,${dataUrl}`;
    }
    
    link.href = dataUrl;
    link.download = `biometric_${record.type_name}_${new Date().getTime()}.bmp`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('Изображение загружено на ваш компьютер.');
}

// Удаление биометрии со страницы деталей
async function deleteDetailBiometric() {
    if (!currentDetailBiometricRecord) return;
    
    if (!confirm('Удалить этот снимок из базы данных? Операция будет записана в журнал системного аудита.')) return;
    
    try {
        await apiFetch(`/api/biometrics/${currentDetailBiometricRecord.id}`, { method: 'DELETE' });
        showToast('Запись биометрии удалена.');
        backToBioModal();
    } catch (err) {
        showToast(err.message, 'error');
    }
}