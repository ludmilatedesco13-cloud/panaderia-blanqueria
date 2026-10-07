import { DEFAULT_IMAGE, setProductImage } from './image-utils.js';
const role = (localStorage.getItem('rol') || 'admin').toLowerCase();
let productos = [];
let carritoVenta = [];
let subcategoriasPorCategoria = {}; 
let metodosPagoDisponibles = [];

const money = value => Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const parsePrice = value => { const text = String(value ?? '').trim().replace(/\s/g, ''); if (!text) return NaN; if (text.includes(',')) return Number(text.replace(/\./g, '').replace(',', '.')); const parts = text.split('.'); return parts.length > 1 && parts.at(-1).length === 3 ? Number(parts.join('')) : Number(text); };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const showError = message => Swal.fire({ icon: 'error', title: 'Atención', text: message, confirmButtonColor: '#6B7B45' });
const showSuccess = (title, text) => Swal.fire({ icon: 'success', title, text, confirmButtonColor: '#6B7B45' });

// --- CONVERSIÓN DE ARCHIVOS A BASE64 ---
function leerFotoComoBase64(inputElement) {
    return new Promise((resolve, reject) => {
        if (!inputElement || !inputElement.files || !inputElement.files[0]) {
            resolve(null);
            return;
        }
        const file = inputElement.files[0];
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
}

// --- GESTIÓN DE MÉTODOS DE PAGO ---
function renderMetodosPago() {
    const select = document.getElementById('metodo_pago');
    if (select) {
        const metodoSeleccionado = select.value;
        select.innerHTML = '<option value="">Seleccioná método de pago</option>';
        metodosPagoDisponibles.forEach(metodo => {
            let texto = metodo.nombre;
            const porcentaje = Number(metodo.valor_ajuste || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
            if (metodo.tipo_ajuste === 'descuento') texto += ` (-${porcentaje}%)`;
            if (metodo.tipo_ajuste === 'recargo') texto += ` (+${porcentaje}%)`;
            select.add(new Option(texto, metodo.nombre));
        });
        select.value = metodoSeleccionado;
    }

    const selectConfig = document.getElementById('metodo_pago_config');
    if (selectConfig) {
        const metodoConfigSeleccionado = selectConfig.value;
        selectConfig.replaceChildren(new Option('-- Seleccioná un método --', ''));
        metodosPagoDisponibles.forEach(metodo => {
            selectConfig.add(new Option(metodo.nombre, metodo.id));
        });
        selectConfig.value = metodosPagoDisponibles.some(metodo => String(metodo.id) === metodoConfigSeleccionado)
            ? metodoConfigSeleccionado
            : String(metodosPagoDisponibles[0]?.id || '');
        cargarConfiguracionMetodoPago();
    }
}

async function cargarMetodosPago() {
    try {
        const metodos = await executeNeonQuery('SELECT * FROM metodos_pago ORDER BY id');
        metodosPagoDisponibles = metodos || [];
        renderMetodosPago();
    } catch (error) {
        console.error('Error cargando métodos de pago:', error);
    }
}

function cargarConfiguracionMetodoPago() {
    const selectMetodo = document.getElementById('metodo_pago_config');
    const selectTipo = document.getElementById('tipo_ajuste_config');
    const inputPorcentaje = document.getElementById('valor_ajuste_config');
    if (!selectMetodo || !selectTipo || !inputPorcentaje) return;

    const metodo = metodosPagoDisponibles.find(item => String(item.id) === selectMetodo.value);
    selectTipo.value = metodo?.tipo_ajuste || '';
    inputPorcentaje.value = metodo?.valor_ajuste ?? 0;
    actualizarCampoPorcentaje();
}

function actualizarCampoPorcentaje() {
    const selectTipo = document.getElementById('tipo_ajuste_config');
    const inputPorcentaje = document.getElementById('valor_ajuste_config');
    if (!selectTipo || !inputPorcentaje) return;

    inputPorcentaje.disabled = !selectTipo.value;
    inputPorcentaje.required = Boolean(selectTipo.value);
    if (selectTipo.value === 'descuento') inputPorcentaje.max = '100';
    else inputPorcentaje.removeAttribute('max');
}

async function guardarConfiguracionMetodoPago(event) {
    event.preventDefault();
    const selectMetodo = document.getElementById('metodo_pago_config');
    const selectTipo = document.getElementById('tipo_ajuste_config');
    const inputPorcentaje = document.getElementById('valor_ajuste_config');
    const metodo = metodosPagoDisponibles.find(item => String(item.id) === selectMetodo.value);
    if (!metodo) return showError('Seleccioná un método de pago.');

    const tipoAjuste = selectTipo.value || null;
    const porcentaje = tipoAjuste ? Number(inputPorcentaje.value) : 0;
    if (tipoAjuste && (!Number.isFinite(porcentaje) || porcentaje < 0)) {
        return showError('Ingresá un porcentaje válido, igual o mayor a cero.');
    }
    if (tipoAjuste === 'descuento' && porcentaje > 100) {
        return showError('El descuento no puede superar el 100%.');
    }

    try {
        await executeNeonQuery(
            'UPDATE metodos_pago SET tipo_ajuste = $1, valor_ajuste = $2 WHERE id = $3',
            [tipoAjuste, porcentaje, metodo.id]
        );
        metodo.tipo_ajuste = tipoAjuste;
        metodo.valor_ajuste = porcentaje;
        renderMetodosPago();
        recalcularTotalVenta();
        showSuccess('Configuración guardada', `Se actualizó "${metodo.nombre}".`);
    } catch (error) {
        showError('No se pudo guardar la configuración: ' + error.message);
    }
}

// --- GESTIÓN DINÁMICA DE CATEGORÍAS Y SUBCATEGORÍAS ---
async function cargarCategoriasYSubcategorias() {
    try {
        const [resCat, resSub] = await Promise.all([
            executeNeonQuery('SELECT * FROM categorias ORDER BY nombre'),
            executeNeonQuery('SELECT * FROM subcategorias ORDER BY nombre')
        ]);

        const selectCategoria = document.getElementById('categoria');
        if (!selectCategoria) return;
        const categoriaActual = selectCategoria.value;

        selectCategoria.innerHTML = '<option value="">-- Seleccionar Categoría --</option>';
        subcategoriasPorCategoria = {};

        (resCat || []).forEach(cat => {
            selectCategoria.add(new Option(cat.nombre, cat.nombre));
            subcategoriasPorCategoria[cat.nombre] = [];
        });

        (resSub || []).forEach(sub => {
            const catRelacionada = resCat.find(c => c.id === sub.categoria_id)?.nombre;
            if (catRelacionada && subcategoriasPorCategoria[catRelacionada]) {
                subcategoriasPorCategoria[catRelacionada].push(sub.nombre);
            }
        });

        if (categoriaActual) {
            selectCategoria.value = categoriaActual;
            actualizarSubcategorias();
        }
    } catch (error) {
        console.error('Error cargando clasificaciones:', error);
    }
}

function actualizarSubcategorias() { 
    const selectSub = document.getElementById('subcategoria');
    const selectCat = document.getElementById('categoria');
    if (!selectSub || !selectCat) return;

    const catSeleccionada = selectCat.value;
    const subActual = selectSub.value;

    selectSub.innerHTML = '<option value="">-- Seleccionar Subcategoría --</option>'; 
    
    const subs = subcategoriasPorCategoria[catSeleccionada] || [];
    subs.forEach(value => selectSub.add(new Option(value, value)));

    if (subs.includes(subActual)) {
        selectSub.value = subActual;
    }
}

async function agregarNuevaCategoria() {
    const { value: nuevaCat } = await Swal.fire({
        title: 'Nueva Categoría',
        input: 'text',
        inputPlaceholder: 'Ej: Panadería, Blanquería...',
        showCancelButton: true,
        confirmButtonColor: '#6B7B45',
        cancelButtonColor: '#A95C42',
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        inputValidator: value => !value.trim() ? '¡Tenés que escribir un nombre!' : undefined
    });

    if (nuevaCat) {
        try {
            await executeNeonQuery('INSERT INTO categorias (nombre) VALUES ($1)', [nuevaCat.trim()]);
            await cargarCategoriasYSubcategorias();
            document.getElementById('categoria').value = nuevaCat.trim();
            actualizarSubcategorias();
            showSuccess('¡Creada!', 'La categoría fue agregada con éxito.');
        } catch (error) {
            showError('No se pudo guardar la categoría: ' + error.message);
        }
    }
}

async function agregarNuevaSubcategoria() {
    const catSeleccionada = document.getElementById('categoria').value;
    if (!catSeleccionada) return showError('Primero seleccioná una categoría para añadirle una subcategoría.');

    const { value: nuevaSub } = await Swal.fire({
        title: `Nueva Subcategoría para "${catSeleccionada}"`,
        input: 'text',
        inputPlaceholder: 'Nombre de la subcategoría...',
        showCancelButton: true,
        confirmButtonColor: '#6B7B45',
        cancelButtonColor: '#A95C42',
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        inputValidator: value => !value.trim() ? '¡Tenés que escribir un nombre!' : undefined
    });

    if (nuevaSub) {
        try {
            const catData = await executeNeonQuery('SELECT id FROM categorias WHERE nombre = $1', [catSeleccionada]);
            if (!catData.length) throw new Error('Categoría no encontrada.');

            await executeNeonQuery('INSERT INTO subcategorias (categoria_id, nombre) VALUES ($1, $2)', [catData[0].id, nuevaSub.trim()]);
            await cargarCategoriasYSubcategorias();
            document.getElementById('categoria').value = catSeleccionada;
            actualizarSubcategorias();
            document.getElementById('subcategoria').value = nuevaSub.trim();
            showSuccess('¡Creada!', 'La subcategoría fue agregada con éxito.');
        } catch (error) {
            showError('No se pudo guardar la subcategoría: ' + error.message);
        }
    }
}

async function eliminarCategoriaSeleccionada() {
    const nombre = document.getElementById('categoria').value;
    if (!nombre) return showError('Primero seleccioná una categoría.');

    const confirmacion = await Swal.fire({
        title: '¿Eliminar categoría?',
        text: `Se eliminará "${nombre}". Esta acción no se puede deshacer.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#A95C42',
        cancelButtonColor: '#6B7B45',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar',
        reverseButtons: true
    });
    if (!confirmacion.isConfirmed) return;

    try {
        const cat = await executeNeonQuery('SELECT id FROM categorias WHERE nombre = $1', [nombre]);
        if (!cat.length) throw new Error('Categoría no encontrada.');

        const subs = await executeNeonQuery('SELECT id FROM subcategorias WHERE categoria_id = $1', [cat[0].id]);
        if (subs.length) return showError('No se puede eliminar: primero eliminá sus subcategorías.');

        const prods = await executeNeonQuery('SELECT id FROM productos WHERE categoria = $1 LIMIT 1', [nombre]);
        if (prods.length) return showError('No se puede eliminar: la categoría está siendo usada por un producto.');

        await executeNeonQuery('DELETE FROM categorias WHERE id = $1', [cat[0].id]);
        await cargarCategoriasYSubcategorias();
        document.getElementById('categoria').value = '';
        actualizarSubcategorias();
        showSuccess('¡Categoría eliminada!', 'La categoría fue eliminada correctamente.');
    } catch (error) {
        showError('No se pudo eliminar la categoría: ' + error.message);
    }
}

async function eliminarSubcategoriaSeleccionada() {
    const categoriaNombre = document.getElementById('categoria').value;
    const nombre = document.getElementById('subcategoria').value;
    if (!categoriaNombre || !nombre) return showError('Seleccioná una categoría y una subcategoría.');

    const confirmacion = await Swal.fire({
        title: '¿Eliminar subcategoría?',
        text: `Se eliminará "${nombre}". Esta acción no se puede deshacer.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#A95C42',
        cancelButtonColor: '#6B7B45',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar',
        reverseButtons: true
    });
    if (!confirmacion.isConfirmed) return;

    try {
        const cat = await executeNeonQuery('SELECT id FROM categorias WHERE nombre = $1', [categoriaNombre]);
        if (!cat.length) throw new Error('Categoría no encontrada.');

        const prods = await executeNeonQuery('SELECT id FROM productos WHERE categoria = $1 AND subcategoria = $2 LIMIT 1', [categoriaNombre, nombre]);
        if (prods.length) return showError('No se puede eliminar: la subcategoría está siendo usada por un producto.');

        await executeNeonQuery('DELETE FROM subcategorias WHERE categoria_id = $1 AND nombre = $2', [cat[0].id, nombre]);
        await cargarCategoriasYSubcategorias();
        document.getElementById('categoria').value = categoriaNombre;
        actualizarSubcategorias();
        showSuccess('¡Subcategoría eliminada!', 'La subcategoría fue eliminada correctamente.');
    } catch (error) {
        showError('No se pudo eliminar la subcategoría: ' + error.message);
    }
}

// --- INVENTARIO Y PRODUCTOS ---
function aplicarRol() { 
    const admin = role === 'admin'; 
    document.querySelectorAll('.admin-only').forEach(element => { element.hidden = !admin; }); 
    const usuarioElem = document.getElementById('nombre-usuario');
    if (usuarioElem) {
        usuarioElem.textContent = localStorage.getItem('usuario') || (admin ? 'Administrador' : 'Empleado'); 
    }
}

function renderDatalist() { 
    const list = document.getElementById('lista_productos'); 
    if (!list) return;
    list.innerHTML = ''; 
    const disponibles = productos.filter(producto => Number(producto.stock) > 0);
    const labels = disponibles.map(producto => {
        const partes = [producto.nombre, producto.presentacion].filter(Boolean);
        let label = `${partes.join(' - ')} - $${money(producto.precio_venta)}`;
        if (producto.marca) label += ` (${producto.marca})`;
        return label;
    });
    const labelCounts = new Map();
    labels.forEach(label => labelCounts.set(label, (labelCounts.get(label) || 0) + 1));

    disponibles.forEach((producto, index) => { 
        const label = labelCounts.get(labels[index]) > 1
            ? `${labels[index]} · #${producto.id}`
            : labels[index];
        const option = new Option(label); 
        option.dataset.id = producto.id; 
        list.appendChild(option); 
    }); 
}

function renderInventario() { 
    const tablaInv = document.getElementById('tabla-inventario');
    if (!tablaInv) return;

    tablaInv.innerHTML = productos.length ? productos.map(p => `
        <tr>
            <td>${escapeHtml(p.id)}</td>
            <td><strong>${escapeHtml(p.nombre)}</strong></td>
            <td>${escapeHtml(p.marca || '-')}</td>
            <td>${escapeHtml(p.presentacion || '-')}</td>
            <td><span class="badge-categoria">${escapeHtml(p.categoria || '-')}</span><span class="subcategoria-texto">${escapeHtml(p.subcategoria || '')}</span></td>
            <td>$${money(p.precio_venta)}</td>
            <td>${escapeHtml(p.stock)} u.</td>
            <td>
                <button type="button" class="btn-icon btn-ver" data-id="${escapeHtml(p.id)}" title="Ver Detalles">🔎</button>
                ${role === 'admin' ? `<button type="button" class="btn-icon btn-editar" data-id="${escapeHtml(p.id)}" title="Editar" style="color:#556B2F;">✏️</button><button type="button" class="btn-icon btn-eliminar" data-id="${escapeHtml(p.id)}" title="Eliminar" style="color:#A95C42;">🗑️</button>` : ''}
            </td>
        </tr>        `).join('') : '<tr><td colspan="8" style="text-align:center;">No hay productos registrados.</td></tr>'; 
}

async function cargarProductos() { 
    const data = await executeNeonQuery('SELECT * FROM productos ORDER BY id');
    productos = data || []; 
    renderInventario(); 
    renderDatalist(); 
}

async function cargarResumen() { 
    if (role !== 'admin') return; 
    const [ventas, stock] = await Promise.all([
        executeNeonQuery('SELECT total FROM ventas'), 
        executeNeonQuery('SELECT id FROM productos WHERE stock = 0')
    ]); 
    const totalVentasElem = document.getElementById('total-ventas');
    const cajaTotalElem = document.getElementById('caja-total');
    const productosSinStockElem = document.getElementById('productos-sin-stock');

    if (totalVentasElem) totalVentasElem.textContent = ventas.length; 
    if (cajaTotalElem) cajaTotalElem.textContent = `$${money(ventas.reduce((sum, item) => sum + Number(item.total || 0), 0))}`; 
    if (productosSinStockElem) productosSinStockElem.textContent = stock.length; 
}

// --- CARRITO Y CÁLCULO CON MÉTODO DE PAGO ---
function actualizarTablaCarrito() { 
    const body = document.querySelector('#tabla-carrito tbody'); 
    if (!body) return;
    body.innerHTML = carritoVenta.length ? carritoVenta.map((item, i) => `
        <tr>
            <td><strong>${escapeHtml(item.nombre)}</strong></td>
            <td>${escapeHtml(item.presentacion || '-')}</td>
            <td>$${money(item.precio)}</td>
            <td>${item.cantidad}</td>
            <td>$${money(item.precio * item.cantidad)}</td>
            <td><button type="button" class="btn-icon quitar-item" data-index="${i}" style="color:#A95C42;">❌</button></td>
        </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;">El carrito está vacío.</td></tr>'; 
    
    recalcularTotalVenta();
}

function calcularTotalesVenta() {
    const subtotal = carritoVenta.reduce((sum, item) => sum + item.precio * item.cantidad, 0);
    const selectMetodo = document.getElementById('metodo_pago');
    const metodoNombre = selectMetodo ? selectMetodo.value : '';
    const metodo = metodosPagoDisponibles.find(m => m.nombre === metodoNombre);
    
    let totalFinal = subtotal;
    let textoDetalle = '';

    if (metodo && subtotal > 0) {
        if (metodo.tipo_ajuste === 'descuento') {
            const descuento = subtotal * (Number(metodo.valor_ajuste) / 100);
            totalFinal = subtotal - descuento;
            textoDetalle = `Subtotal: $${money(subtotal)} | Descuento (${metodo.valor_ajuste}%): -$${money(descuento)}`;
        } else if (metodo.tipo_ajuste === 'recargo') {
            const recargo = subtotal * (Number(metodo.valor_ajuste) / 100);
            totalFinal = subtotal + recargo;
            textoDetalle = `Subtotal: $${money(subtotal)} | Recargo (${metodo.valor_ajuste}%): +$${money(recargo)}`;
        } else {
            textoDetalle = `Pago contado / sin recargos.`;
        }
    }

    const detalleCalc = document.getElementById('detalle-calculo-pago');
    if (detalleCalc) detalleCalc.textContent = textoDetalle;
    return { subtotal, totalFinal };
}

function recalcularTotalVenta() {
    const { totalFinal } = calcularTotalesVenta();
    const montoTotal = document.getElementById('monto-total-venta');
    if (montoTotal) montoTotal.textContent = money(totalFinal);
}

function agregarAlCarrito() { 
    const inputBusqueda = document.getElementById('producto_buscar');
    const inputCant = document.getElementById('cantidad');
    if (!inputBusqueda || !inputCant) return;

    const value = inputBusqueda.value.trim();
    const quantity = Number(inputCant.value);
    const option = Array.from(document.getElementById('lista_productos')?.options || [])
        .find(item => item.value === value);
    const product = option
        ? productos.find(item => String(item.id) === option.dataset.id)
        : null;
    if (!product || !Number.isInteger(quantity) || quantity <= 0) return showError('Seleccioná un producto válido y una cantidad mayor a 0.'); 
    const existing = carritoVenta.find(item => String(item.id) === String(product.id)); 
    if (Number(product.stock) <= 0 || (existing?.cantidad || 0) + quantity > Number(product.stock)) return showError(`Stock insuficiente. Disponibles: ${product.stock} u.`); 
    if (existing) existing.cantidad += quantity; 
    else carritoVenta.push({ id: product.id, nombre: product.nombre, presentacion: product.presentacion || '', precio: Number(product.precio_venta), cantidad: quantity }); 
    inputBusqueda.value = ''; 
    actualizarTablaCarrito(); 
}

async function registrarVenta() { 
    if (!carritoVenta.length) return showError('Añadí al menos un producto antes de finalizar la venta.'); 
    const selectMetodo = document.getElementById('metodo_pago');
    const metodoPago = selectMetodo ? selectMetodo.value : '';
    if (!metodoPago) return showError('Seleccioná un método de pago.');

    const { totalFinal } = calcularTotalesVenta(); 
    
    try { 
        const ventaRes = await executeNeonQuery(
            'INSERT INTO ventas (total, metodo_pago) VALUES ($1, $2) RETURNING id', 
            [totalFinal, metodoPago]
        );
        const ventaId = ventaRes[0].id; 
        
        for (const item of carritoVenta) {
            const itemRes = await executeNeonQuery(
                `WITH stock_actualizado AS (
                    UPDATE productos
                    SET stock = stock - $1
                    WHERE id = $2 AND stock >= $1
                    RETURNING id
                )
                INSERT INTO detalle_venta (venta_id, producto_id, cantidad, precio_unitario)
                SELECT $3, id, $1, $4 FROM stock_actualizado
                RETURNING producto_id`,
                [item.cantidad, item.id, ventaId, item.precio]
            );
            if (!itemRes.length) {
                throw new Error(`El stock de "${item.nombre}" cambió y ya no alcanza para completar la venta.`);
            }
        }

        carritoVenta = []; 
        if (selectMetodo) selectMetodo.value = '';
        actualizarTablaCarrito(); 
        await Promise.all([cargarProductos(), cargarResumen()]); 
        showSuccess('¡Venta Registrada! 🥖', 'La operación fue exitosa y el stock ha sido actualizado.'); 
    } catch (error) { 
        showError('No se pudo registrar la venta: ' + error.message); 
    } 
}

async function guardarProducto(event) { 
    event.preventDefault(); 
    const form = event.currentTarget; 
    try { 
        const priceCost = parsePrice(document.getElementById('precio_costo').value); 
        const priceSale = parsePrice(document.getElementById('precio_venta').value); 
        const stock = Number(document.getElementById('stock').value); 
        
        if (!document.getElementById('nombre').value.trim() || !Number.isFinite(priceCost) || priceCost <= 0 || !Number.isFinite(priceSale) || priceSale <= 0 || !Number.isInteger(stock) || stock < 0) {
            throw new Error('Completá los datos obligatorios con valores válidos.'); 
        }

        // Lectura robusta del input de archivo para capturar la imagen correctamente
        const inputFoto = document.getElementById('foto') || document.getElementById('foto_archivo') || document.querySelector('input[type="file"]');
        let fotoUrl = await leerFotoComoBase64(inputFoto);
        if (!fotoUrl) {
            fotoUrl = DEFAULT_IMAGE;
        }
        
        const product = { 
            nombre: document.getElementById('nombre').value.trim(), 
            marca: document.getElementById('marca').value.trim(), 
            categoria: document.getElementById('categoria').value, 
            subcategoria: document.getElementById('subcategoria').value, 
            presentacion: document.getElementById('presentacion')?.value.trim() || '',
            precio_costo: priceCost, 
            precio_venta: priceSale, 
            stock, 
            caracteristicas: document.getElementById('caracteristicas')?.value.trim() || '', 
            foto_url: fotoUrl 
        }; 
        
        await executeNeonQuery(
            'INSERT INTO productos (nombre, marca, presentacion, categoria, subcategoria, precio_costo, precio_venta, stock, caracteristicas, foto_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
            [product.nombre, product.marca, product.presentacion, product.categoria, product.subcategoria, product.precio_costo, product.precio_venta, product.stock, product.caracteristicas, product.foto_url]
        );
        
        form.reset(); 
        const preview = document.getElementById('vista-previa-foto') || document.getElementById('preview-foto');
        if (preview) preview.style.display = 'none';

        actualizarSubcategorias(); 
        await Promise.all([cargarProductos(), cargarResumen()]); 
        showSuccess('¡Producto Guardado! 🥐', 'El artículo fue registrado con éxito.'); 
    } catch (error) { 
        showError(error.message); 
    } 
}

async function eliminarProducto(id) { 
    const product = productos.find(p => String(p.id) === String(id)); 
    const confirmation = await Swal.fire({ 
        title: '¿Seguro que quieres eliminar este producto?', 
        text: `Se eliminará "${product?.nombre || ''}" del inventario.`, 
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
        await executeNeonQuery('DELETE FROM productos WHERE id = $1', [id]);
        await Promise.all([cargarProductos(), cargarResumen()]); 
        showSuccess('¡Eliminado! 🗑️', 'El artículo fue eliminado del inventario.'); 
    } catch (error) {
        showError('No se pudo eliminar: ' + error.message);
    }
}

function mostrarDetalle(product) { 
    document.getElementById('modal-titulo-prod').textContent = product.nombre; 
    document.getElementById('modal-marca-prod').textContent = product.marca || 'N/A'; 
    document.getElementById('modal-presentacion-prod').textContent = product.presentacion || 'No especificada';
    document.getElementById('modal-precio-prod').textContent = money(product.precio_venta); 
    document.getElementById('modal-stock-prod').textContent = product.stock; 
    document.getElementById('modal-info-prod').textContent = product.caracteristicas || 'Sin descripción.'; 
    setProductImage(document.getElementById('modal-img-prod'), product.foto_url, product.foto);
    document.getElementById('modal-detalles').style.display = 'flex'; 
}

async function cargarReporte() { 
    const [sales, details] = await Promise.all([
        executeNeonQuery('SELECT fecha, total FROM ventas ORDER BY fecha DESC'), 
        executeNeonQuery(`
            SELECT dv.cantidad, p.nombre, p.marca, p.presentacion 
            FROM detalle_venta dv 
            JOIN productos p ON dv.producto_id = p.id
        `)
    ]); 
    
    const months = {}; 
    sales.forEach(sale => { 
        const month = String(sale.fecha || '').slice(0, 7) || 'Sin fecha'; 
        months[month] = months[month] || { count: 0, total: 0 }; 
        months[month].count++; 
        months[month].total += Number(sale.total || 0); 
    }); 
    
    const best = {}; 
    details.forEach(detail => { 
        const name = detail.nombre;
        const productLabel = detail.presentacion ? `${name} - ${detail.presentacion}` : name;
        best[productLabel] = best[productLabel] || { brand: detail.marca || '-', count: 0 };
        best[productLabel].count += Number(detail.cantidad || 0); 
    }); 
    
    const resultadoEst = document.getElementById('resultadoEstadisticas');
    if (resultadoEst) {
        resultadoEst.innerHTML = `
            <h3 style="color:#4E3629;">💰 Recaudación por Mes</h3>
            <ul style="list-style:none;padding:0;margin-bottom:15px;">${Object.entries(months).map(([month, item]) => `<li style="padding:8px 0;border-bottom:1px solid #EFECE6;display:flex;justify-content:space-between;"><span>📅 <strong>${escapeHtml(month)}</strong> (${item.count} ventas)</span><strong>$${money(item.total)}</strong></li>`).join('') || '<li>No hay ventas.</li>'}</ul>
            <h3 style="color:#4E3629;">🥐 Productos más Vendidos</h3>
            <ul style="list-style:none;padding:0;">${Object.entries(best).sort((a, b) => b[1].count - a[1].count).slice(0, 5).map(([name, item]) => `<li style="padding:8px 0;border-bottom:1px solid #EFECE6;display:flex;justify-content:space-between;"><span>🥖 <strong>${escapeHtml(name)}</strong> (${escapeHtml(item.brand)})</span><strong>${item.count} un.</strong></li>`).join('') || '<li>No hay datos.</li>'}</ul>`; 
    }
    window.reporte = { sales, best }; 
}

function descargarReporte() { 
    const report = window.reporte || { sales: [], best: {} }; 
    const rows = [['Mes', 'Cantidad de Operaciones', 'Total Recaudado ($)']]; 
    const months = {}; 
    report.sales.forEach(sale => { 
        const month = String(sale.fecha || '').slice(0, 7) || 'Sin fecha'; 
        months[month] = months[month] || { count: 0, total: 0 }; 
        months[month].count++; 
        months[month].total += Number(sale.total || 0); 
    }); 
    Object.entries(months).forEach(([month, item]) => rows.push([month, item.count, item.total.toFixed(2).replace('.', ',')])); 
    rows.push([], ['Producto', 'Marca', 'Unidades Vendidas']); 
    Object.entries(report.best).forEach(([name, item]) => rows.push([name, item.brand, item.count])); 
    
    const csv = '\uFEFF' + rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n'); 
    const link = document.createElement('a'); 
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); 
    link.download = `reporte_panaderia_blanqueria_${new Date().toISOString().slice(0, 10)}.csv`; 
    link.click(); 
    showSuccess('¡Reporte descargado!', 'El archivo CSV se generó con éxito.'); 
}

document.addEventListener('DOMContentLoaded', async () => { 
    if (!localStorage.getItem('usuario')) { window.location.replace('login.html'); return; } 
    aplicarRol(); 
    actualizarTablaCarrito(); 

    await Promise.all([
        cargarCategoriasYSubcategorias(),
        cargarMetodosPago()
    ]);
    
    const selectCat = document.getElementById('categoria');
    if (selectCat) selectCat.addEventListener('change', actualizarSubcategorias); 

    const selectMetodo = document.getElementById('metodo_pago');
    if (selectMetodo) selectMetodo.addEventListener('change', recalcularTotalVenta);

    const selectMetodoConfig = document.getElementById('metodo_pago_config');
    if (selectMetodoConfig) selectMetodoConfig.addEventListener('change', cargarConfiguracionMetodoPago);

    const selectTipoAjuste = document.getElementById('tipo_ajuste_config');
    if (selectTipoAjuste) selectTipoAjuste.addEventListener('change', actualizarCampoPorcentaje);

    const formMetodoPagoConfig = document.getElementById('form-config-metodo-pago');
    if (formMetodoPagoConfig) formMetodoPagoConfig.addEventListener('submit', guardarConfiguracionMetodoPago);
    
    const btnNewCat = document.getElementById('btn-nueva-categoria');
    if (btnNewCat) btnNewCat.addEventListener('click', agregarNuevaCategoria);

    const btnNewSub = document.getElementById('btn-nueva-subcategoria');
    if (btnNewSub) btnNewSub.addEventListener('click', agregarNuevaSubcategoria);

    const btnDelCat = document.getElementById('btn-eliminar-categoria');
    if (btnDelCat) btnDelCat.addEventListener('click', eliminarCategoriaSeleccionada);

    const btnDelSub = document.getElementById('btn-eliminar-subcategoria');
    if (btnDelSub) btnDelSub.addEventListener('click', eliminarSubcategoriaSeleccionada);

    const btnAddItem = document.getElementById('btn-agregar-item');
    if (btnAddItem) btnAddItem.addEventListener('click', agregarAlCarrito); 

    const prodBuscar = document.getElementById('producto_buscar');
    if (prodBuscar) prodBuscar.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); agregarAlCarrito(); } }); 
    
    const tablaCarritoBody = document.querySelector('#tabla-carrito tbody');
    if (tablaCarritoBody) {
        tablaCarritoBody.addEventListener('click', event => { 
            const button = event.target.closest('.quitar-item'); 
            if (button) { carritoVenta.splice(Number(button.dataset.index), 1); actualizarTablaCarrito(); } 
        }); 
    }
    
    const formVentas = document.getElementById('form-ventas-multiples');
    if (formVentas) formVentas.addEventListener('submit', event => { event.preventDefault(); registrarVenta(); }); 

    const formProducto = document.getElementById('form-nuevo-producto');
    if (formProducto) formProducto.addEventListener('submit', guardarProducto); 

    // Previsualización de la foto seleccionada
    const inputFoto = document.getElementById('foto') || document.getElementById('foto_archivo') || document.querySelector('input[type="file"]');
    const previewFoto = document.getElementById('vista-previa-foto') || document.getElementById('preview-foto');
    if (inputFoto && previewFoto) {
        inputFoto.addEventListener('change', async () => {
            const base64 = await leerFotoComoBase64(inputFoto);
            if (base64) {
                previewFoto.src = base64;
                previewFoto.style.display = 'block';
            } else {
                previewFoto.style.display = 'none';
            }
        });
    }
    
    const tablaInventario = document.getElementById('tabla-inventario');
    if (tablaInventario) {
        tablaInventario.addEventListener('click', event => { 
            const button = event.target.closest('button'); 
            if (!button) return; 
            const product = productos.find(item => String(item.id) === button.dataset.id); 
            if (!product) return; 
            if (button.classList.contains('btn-ver')) mostrarDetalle(product); 
            if (button.classList.contains('btn-editar')) window.location.href = `editar-producto.html?id=${encodeURIComponent(product.id)}`; 
            if (button.classList.contains('btn-eliminar')) eliminarProducto(product.id); 
        }); 
    }
    
    const btnCloseModal = document.getElementById('btn-close-modal');
    if (btnCloseModal) btnCloseModal.addEventListener('click', () => { document.getElementById('modal-detalles').style.display = 'none'; }); 

    const btnReporte = document.getElementById('btnReporte');
    if (btnReporte) {
        btnReporte.addEventListener('click', async event => { 
            event.preventDefault(); 
            const modalRep = document.getElementById('modalReporte');
            if (modalRep) modalRep.style.display = 'flex'; 
            try { await cargarReporte(); } catch (error) { showError(error.message); } 
        }); 
    }

    const btnExportar = document.getElementById('btn-exportar');
    if (btnExportar) btnExportar.addEventListener('click', descargarReporte); 

    const cerrarModalRep = document.getElementById('cerrarModalReporte');
    if (cerrarModalRep) cerrarModalRep.addEventListener('click', () => { document.getElementById('modalReporte').style.display = 'none'; }); 

    const btnSalir = document.getElementById('btn-salir');
    if (btnSalir) btnSalir.addEventListener('click', () => { localStorage.clear(); window.location.href = 'login.html'; }); 
    
    try { 
        await Promise.all([cargarProductos(), cargarResumen()]); 
    } catch (error) { 
        showError(`No se pudo cargar la información: ${error.message}`); 
    } 
});