/* ========================================
   GAZO98 - 98風メニューバー
   ======================================== */

const Menu = (() => {
    let activeItem = null;
    let activeDropdown = null;
    let menubar = null;
    const actionHandlers = {};

    function init() {
        menubar = document.getElementById('menubar');
        if (!menubar) return;

        /* ドロップダウンをbody直下に移動（z-index問題回避） */
        const menuItems = menubar.querySelectorAll('.menu-item');
        menuItems.forEach(item => {
            const label = item.querySelector('.menu-label');
            const dropdown = item.querySelector('.menu-dropdown');
            if (!label || !dropdown) return;

            /* DOMからドロップダウンを外してbodyに移動 */
            item.removeChild(dropdown);
            dropdown.style.display = 'none';
            dropdown.style.position = 'fixed';
            dropdown.style.zIndex = '10000';
            document.body.appendChild(dropdown);

            /* データを紐付け */
            item._dropdown = dropdown;
            item._label = label;

            /* ラベルクリック */
            label.addEventListener('click', (e) => {
                e.stopPropagation();
                if (activeItem === item) {
                    closeAll();
                } else {
                    closeAll();
                    openMenu(item);
                }
            });

            /* ホバーで切替 */
            label.addEventListener('mouseenter', () => {
                if (activeItem && activeItem !== item) {
                    closeAll();
                    openMenu(item);
                }
            });

            /* ドロップダウン内のエントリクリック */
            dropdown.querySelectorAll('.menu-entry').forEach(entry => {
                entry.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (entry.classList.contains('disabled')) return;
                    const action = entry.dataset.action;
                    closeAll();
                    if (action && actionHandlers[action]) {
                        actionHandlers[action]();
                    }
                });
            });
        });

        document.addEventListener('click', () => {
            closeAll();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeAll();
        });
    }

    function openMenu(item) {
        const dropdown = item._dropdown;
        const label = item._label;
        if (!dropdown || !label) return;

        /* ラベルの位置を基準にドロップダウンを配置 */
        const rect = label.getBoundingClientRect();
        dropdown.style.left = rect.left + 'px';
        dropdown.style.top = rect.bottom + 'px';
        dropdown.style.display = 'block';

        label.classList.add('active-label');
        activeItem = item;
        activeDropdown = dropdown;
    }

    function closeAll() {
        if (activeItem) {
            activeItem._label.classList.remove('active-label');
            activeItem = null;
        }
        if (activeDropdown) {
            activeDropdown.style.display = 'none';
            activeDropdown = null;
        }
    }

    function on(action, handler) {
        actionHandlers[action] = handler;
    }

    function enableEntry(action) {
        const entry = document.querySelector(`.menu-entry[data-action="${action}"]`);
        if (entry) entry.classList.remove('disabled');
    }

    function disableEntry(action) {
        const entry = document.querySelector(`.menu-entry[data-action="${action}"]`);
        if (entry) entry.classList.add('disabled');
    }

    return { init, on, enableEntry, disableEntry };
})();
