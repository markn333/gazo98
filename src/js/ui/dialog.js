/* ========================================
   GAZO98 - 98風ダイアログシステム
   ======================================== */

const Dialog = (() => {
    let overlay = null;
    let container = null;
    let titleBar = null;
    let titleEl = null;
    let bodyEl = null;
    let buttonsEl = null;
    let closeBtn = null;
    let currentResolve = null;

    /* ドラッグ状態 */
    let dragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    function init() {
        overlay = document.getElementById('dialog-overlay');
        container = document.getElementById('dialog-container');
        titleBar = container.querySelector('.dialog-titlebar');
        titleEl = container.querySelector('.dialog-title');
        bodyEl = container.querySelector('.dialog-body');
        buttonsEl = container.querySelector('.dialog-buttons');
        closeBtn = container.querySelector('.dialog-close');

        closeBtn.addEventListener('click', () => close(null));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(null);
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay.style.display !== 'none') {
                close(null);
            }
        });

        /* タイトルバードラッグ */
        titleBar.style.cursor = 'move';
        titleBar.addEventListener('mousedown', onDragStart);
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragEnd);
    }

    function onDragStart(e) {
        if (e.target === closeBtn) return;
        dragging = true;
        const rect = container.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;
        e.preventDefault();
    }

    function onDragMove(e) {
        if (!dragging) return;
        const x = e.clientX - dragOffsetX;
        const y = e.clientY - dragOffsetY;
        container.style.position = 'fixed';
        container.style.left = x + 'px';
        container.style.top = y + 'px';
        container.style.margin = '0';
    }

    function onDragEnd() {
        dragging = false;
    }

    function resetPosition() {
        container.style.position = '';
        container.style.left = '';
        container.style.top = '';
        container.style.margin = '';
    }

    function show(options) {
        const { title, body, buttons } = options;

        titleEl.textContent = title || '';

        if (typeof body === 'string') {
            bodyEl.innerHTML = body;
        } else if (body instanceof HTMLElement) {
            bodyEl.innerHTML = '';
            bodyEl.appendChild(body);
        }

        buttonsEl.innerHTML = '';
        if (buttons && buttons.length > 0) {
            buttons.forEach(btn => {
                const button = document.createElement('button');
                button.className = 'pc98-button';
                button.textContent = `[ ${btn.label} ]`;
                button.addEventListener('click', () => close(btn.value));
                buttonsEl.appendChild(button);
            });
        }

        resetPosition();
        overlay.style.display = 'flex';

        return new Promise(resolve => {
            currentResolve = resolve;
        });
    }

    function alert(title, message) {
        return show({
            title,
            body: `<p>${message}</p>`,
            buttons: [{ label: 'OK', value: 'ok' }]
        });
    }

    function confirm(title, message) {
        return show({
            title,
            body: `<p>${message}</p>`,
            buttons: [
                { label: 'OK', value: true },
                { label: 'Cancel', value: false }
            ]
        });
    }

    function close(value) {
        overlay.style.display = 'none';
        bodyEl.innerHTML = '';
        buttonsEl.innerHTML = '';
        resetPosition();
        if (currentResolve) {
            currentResolve(value);
            currentResolve = null;
        }
    }

    return { init, show, alert, confirm, close };
})();
