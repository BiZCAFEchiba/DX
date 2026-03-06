// ============================================================
// views/staffManager.js - スタッフ管理画面
// ============================================================
var StaffManagerView = (function () {

  function render() {
    Nav.render('staffManager');

    var main = document.getElementById('main-content');
    main.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><span>\u8AAD\u307F\u8FBC\u307F\u4E2D...</span></div>';

    API.getStaff()
      .then(function (res) {
        if (!res.success) {
          main.innerHTML = '<div class="empty-state"><span class="icon">\u26A0\uFE0F</span><span class="text">' + (res.error || '\u53D6\u5F97\u5931\u6557') + '</span></div>';
          return;
        }
        renderList(res.data.staff);
      })
      .catch(function (err) {
        main.innerHTML = '<div class="empty-state"><span class="icon">\u26A0\uFE0F</span><span class="text">\u901A\u4FE1\u30A8\u30E9\u30FC: ' + err.message + '</span></div>';
      });
  }

  function renderList(staffList) {
    var main = document.getElementById('main-content');
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
      '<h2 style="font-size:1.1rem;font-weight:700;">\u30B9\u30BF\u30C3\u30D5\u7BA1\u7406</h2>' +
      '<button class="btn btn-primary btn-sm" id="btn-add-staff">+ \u8FFD\u52A0</button>' +
      '</div>';

    html += '<div class="card">';
    if (staffList.length === 0) {
      html += '<div class="empty-state"><span class="icon">\uD83D\uDC65</span><span class="text">\u30B9\u30BF\u30C3\u30D5\u304C\u767B\u9332\u3055\u308C\u3066\u3044\u307E\u305B\u3093</span></div>';
    } else {
      staffList.forEach(function (s) {
        html += '<div class="staff-item">' +
          '<div class="staff-info">' +
            '<div class="name">\uD83D\uDC64 ' + escHtml(s.name) + '</div>' +
            '<div class="account">' + (s.accountId || '\u30A2\u30AB\u30A6\u30F3\u30C8ID\u672A\u8A2D\u5B9A') + '</div>' +
          '</div>' +
          '<div class="staff-actions">' +
            '<button class="btn btn-outline btn-sm btn-edit" data-name="' + escAttr(s.name) + '" data-account="' + escAttr(s.accountId) + '">\u7DE8\u96C6</button>' +
            '<button class="btn btn-danger btn-sm btn-delete" data-name="' + escAttr(s.name) + '">\u524A\u9664</button>' +
          '</div>' +
          '</div>';
      });
    }
    html += '</div>';

    main.innerHTML = html;

    document.getElementById('btn-add-staff').addEventListener('click', function () {
      showStaffModal(null, null);
    });

    main.querySelectorAll('.btn-edit').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showStaffModal(btn.dataset.name, btn.dataset.account);
      });
    });

    main.querySelectorAll('.btn-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        confirmDelete(btn.dataset.name);
      });
    });
  }

  function showStaffModal(name, accountId) {
    var isEdit = !!name;
    var title = isEdit ? '\u30B9\u30BF\u30C3\u30D5\u7DE8\u96C6' : '\u30B9\u30BF\u30C3\u30D5\u8FFD\u52A0';

    var html =
      '<div class="modal-title">' + title + '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">\u540D\u524D\uFF08PDF\u8868\u8A18\uFF09</label>' +
        '<input class="form-input" id="modal-name" value="' + escAttr(name || '') + '">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">LINE WORKS \u30A2\u30AB\u30A6\u30F3\u30C8ID</label>' +
        '<input class="form-input" id="modal-account" placeholder="example@bizcafe" value="' + escAttr(accountId || '') + '">' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-outline" id="modal-cancel">\u30AD\u30E3\u30F3\u30BB\u30EB</button>' +
        '<button class="btn btn-primary" id="modal-save">\u4FDD\u5B58</button>' +
      '</div>';

    Modal.show(html);

    document.getElementById('modal-cancel').addEventListener('click', Modal.close);
    document.getElementById('modal-save').addEventListener('click', function () {
      var newName = document.getElementById('modal-name').value.trim();
      var newAccount = document.getElementById('modal-account').value.trim();

      if (!newName) {
        Toast.show('\u540D\u524D\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044', 'error');
        return;
      }

      var saveBtn = document.getElementById('modal-save');
      saveBtn.disabled = true;
      saveBtn.textContent = '\u4FDD\u5B58\u4E2D...';

      API.updateStaff(newName, newAccount, isEdit ? name : undefined)
        .then(function (res) {
          if (res.success) {
            Modal.close();
            Toast.show(isEdit ? '\u30B9\u30BF\u30C3\u30D5\u3092\u66F4\u65B0\u3057\u307E\u3057\u305F' : '\u30B9\u30BF\u30C3\u30D5\u3092\u8FFD\u52A0\u3057\u307E\u3057\u305F', 'success');
            render();
          } else {
            Toast.show(res.error || '\u4FDD\u5B58\u306B\u5931\u6557\u3057\u307E\u3057\u305F', 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = '\u4FDD\u5B58';
          }
        })
        .catch(function (err) {
          Toast.show('\u901A\u4FE1\u30A8\u30E9\u30FC', 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = '\u4FDD\u5B58';
        });
    });
  }

  function confirmDelete(name) {
    var html =
      '<div class="modal-title">\u524A\u9664\u78BA\u8A8D</div>' +
      '<p style="margin-bottom:8px;">\u300C' + escHtml(name) + '\u300D\u3092\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F</p>' +
      '<p style="font-size:0.85rem;color:var(--gray-500);">\u3053\u306E\u64CD\u4F5C\u306F\u53D6\u308A\u6D88\u305B\u307E\u305B\u3093\u3002</p>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-outline" id="modal-cancel">\u30AD\u30E3\u30F3\u30BB\u30EB</button>' +
        '<button class="btn btn-danger" id="modal-delete">\u524A\u9664</button>' +
      '</div>';

    Modal.show(html);

    document.getElementById('modal-cancel').addEventListener('click', Modal.close);
    document.getElementById('modal-delete').addEventListener('click', function () {
      var delBtn = document.getElementById('modal-delete');
      delBtn.disabled = true;

      API.deleteStaff(name)
        .then(function (res) {
          Modal.close();
          if (res.success) {
            Toast.show('\u524A\u9664\u3057\u307E\u3057\u305F', 'success');
            render();
          } else {
            Toast.show(res.error || '\u524A\u9664\u306B\u5931\u6557', 'error');
          }
        })
        .catch(function () {
          Modal.close();
          Toast.show('\u901A\u4FE1\u30A8\u30E9\u30FC', 'error');
        });
    });
  }

  function escHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function escAttr(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return { render: render };
})();
