const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const showError = message => Swal.fire({ icon: 'error', title: 'Atención', text: message, confirmButtonColor: '#6B7B45' });
const showSuccess = (title, text) => Swal.fire({ icon: 'success', title, text, confirmButtonColor: '#6B7B45' });

function getRoleDisplay(role) {
    const normalizedRole = String(role ?? '').toLowerCase();
    if (normalizedRole === 'admin') return { label: 'Administrador', className: 'role-admin' };
    if (normalizedRole === 'vendedor') return { label: 'Vendedor / Empleado', className: 'role-vendedor' };
    return { label: role || 'Sin rol', className: 'role-other' };
}

let usuarios = [];

async function cargarUsuarios() {
    try {
        const data = await executeNeonQuery('SELECT * FROM usuario ORDER BY id');
        usuarios = data || [];
        renderUsuarios();
    } catch (error) {
        showError('No se pudieron cargar los usuarios: ' + error.message);
    }
}

function renderUsuarios() {
    const tbody = document.getElementById('tabla-usuarios');
    if (!usuarios.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No hay usuarios registrados.</td></tr>';
        return;
    }

    tbody.innerHTML = usuarios.map(u => {
        const roleDisplay = getRoleDisplay(u.rol);
        return `
            <tr>
                <td>${escapeHtml(u.id)}</td>
                <td><strong>${escapeHtml(u.usuario)}</strong></td>
                <td><span class="role-badge ${roleDisplay.className}">${escapeHtml(roleDisplay.label)}</span></td>
                <td style="text-align:center;">
                    <div class="user-actions">
                        <button type="button" class="user-action btn-editar" data-id="${escapeHtml(u.id)}" title="Editar Usuario">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button type="button" class="user-action delete btn-eliminar" data-id="${escapeHtml(u.id)}" title="Eliminar Usuario">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function crearUsuario(event) {
    event.preventDefault();
    const usuarioInput = document.getElementById('usuario').value.trim();
    const passwordInput = document.getElementById('password').value.trim();
    const rolInput = document.getElementById('rol').value;

    if (!usuarioInput || !passwordInput) {
        return showError('Completá todos los campos obligatorios.');
    }

    try {
        await executeNeonQuery(
            'INSERT INTO usuario (usuario, password, rol) VALUES ($1, $2, $3)',
            [usuarioInput, passwordInput, rolInput]
        );

        document.getElementById('form-usuario').reset();
        await cargarUsuarios();
        showSuccess('¡Usuario Creado! 👤', 'El nuevo usuario fue registrado con éxito.');
    } catch (error) {
        showError('No se pudo crear el usuario: ' + error.message);
    }
}

async function editarUsuario(id) {
    const user = usuarios.find(u => String(u.id) === String(id));
    if (!user) return;

    const { value: formValues } = await Swal.fire({
        title: 'Editar Usuario',
        html: `
            <div class="swal-user-form">
                <div class="swal-user-field">
                    <label for="swal-usuario">Nombre de Usuario</label>
                    <input id="swal-usuario" class="swal2-input" value="${escapeHtml(user.usuario)}" style="margin:0;width:100%;">
                </div>
                <div class="swal-user-field" style="margin-top:10px;">
                    <label for="swal-password">Nueva Contraseña (dejar en blanco para no cambiar)</label>
                    <input id="swal-password" type="password" class="swal2-input" placeholder="••••" style="margin:0;width:100%;">
                </div>
                <div class="swal-user-field" style="margin-top:10px;">
                    <label for="swal-rol">Rol</label>
                    <select id="swal-rol" class="swal2-select" style="margin:0;width:100%;height:44px;background:#FDFBF7;border:1px solid #DCD6CD;border-radius:10px;padding:0 10px;">
                        <option value="vendedor" ${user.rol === 'vendedor' ? 'selected' : ''}>Vendedor / Empleado</option>
                        <option value="admin" ${user.rol === 'admin' ? 'selected' : ''}>Administrador</option>
                    </select>
                </div>
            </div>
        `,
        customClass: { popup: 'user-edit-popup' },
        showCancelButton: true,
        confirmButtonColor: '#6B7B45',
        cancelButtonColor: '#A95C42',
        confirmButtonText: 'Guardar Cambios',
        cancelButtonText: 'Cancelar',
        focusConfirm: false,
        preConfirm: () => {
            return {
                usuario: document.getElementById('swal-usuario').value.trim(),
                password: document.getElementById('swal-password').value.trim(),
                rol: document.getElementById('swal-rol').value
            };
        }
    });

    if (!formValues) return;

    if (!formValues.usuario) {
        return showError('El nombre de usuario no puede estar vacío.');
    }

    try {
        if (formValues.password) {
            await executeNeonQuery(
                'UPDATE usuario SET usuario = $1, password = $2, rol = $3 WHERE id = $4',
                [formValues.usuario, formValues.password, formValues.rol, id]
            );
        } else {
            await executeNeonQuery(
                'UPDATE usuario SET usuario = $1, rol = $2 WHERE id = $3',
                [formValues.usuario, formValues.rol, id]
            );
        }

        await cargarUsuarios();
        showSuccess('¡Actualizado! ✨', 'Los datos del usuario fueron modificados correctamente.');
    } catch (error) {
        showError('No se pudo actualizar: ' + error.message);
    }
}

async function eliminarUsuario(id) {
    const user = usuarios.find(u => String(u.id) === String(id));
    const confirmation = await Swal.fire({
        title: '¿Eliminar usuario?',
        text: `Se borrará el acceso para "${user?.usuario || ''}".`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#6B7B45',
        cancelButtonColor: '#A95C42',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar',
        reverseButtons: true
    });

    if (!confirmation.isConfirmed) return;

    try {
        await executeNeonQuery('DELETE FROM usuario WHERE id = $1', [id]);
        await cargarUsuarios();
        showSuccess('¡Eliminado! 🗑️', 'El usuario fue eliminado del sistema.');
    } catch (error) {
        showError('No se pudo eliminar el usuario: ' + error.message);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (!localStorage.getItem('usuario')) {
        window.location.replace('login.html');
        return;
    }

    cargarUsuarios();

    document.getElementById('form-usuario').addEventListener('submit', crearUsuario);

    document.getElementById('tabla-usuarios').addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;
        const id = button.dataset.id;
        if (button.classList.contains('btn-editar')) editarUsuario(id);
        if (button.classList.contains('btn-eliminar')) eliminarUsuario(id);
    });
});