import React, { useEffect, useState, useRef, useCallback } from 'react';
import './App.css';
import { SettingsButton, PasswordModal, AdminPanel } from './AdminPanel';

import { apiUrl } from './getApiBase';
import { isCorreoInstitucional } from './correoInstitucional';
import { parseApiResponse, apiErrorMessage } from './apiResponse';

/**
 * Drive links que llegan desde el backend (o pegados en la planilla) a un formato
 * que suele funcionar mejor para `<img>`.
 */
function normalizeDrivePhotoUrlClient(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';

  // Si ya viene como thumbnail, lo dejamos igual.
  if (s.includes('drive.google.com/thumbnail')) return s;

  const fromPath = s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fromPath) {
    return `https://drive.google.com/thumbnail?id=${fromPath[1]}&sz=w128`;
  }

  const fromUcQuery = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (fromUcQuery) {
    return `https://drive.google.com/thumbnail?id=${fromUcQuery[1]}&sz=w128`;
  }

  // Si pusieron solo el id.
  if (/^[a-zA-Z0-9_-]{25,}$/.test(s) && !s.includes('://')) {
    return `https://drive.google.com/thumbnail?id=${s}&sz=w128`;
  }

  return s;
}

function App() {
  const [tutores, setTutores] = useState([]);
  const [carrerasMentor, setCarrerasMentor] = useState([]);
  const [carrerasAlumno, setCarrerasAlumno] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [seleccion, setSeleccion] = useState(null);
  const [form, setForm] = useState({
    nombre: '',
    apellido: '',
    anioCarrera: '',
    carrera: '',
    correo: '',
    celular: '',
    linkedin: '',
    sexo: '',
  });
  const [mensaje, setMensaje] = useState('');
  const [enviando, setEnviando] = useState(false);
  
  // Filtros
  const [filtros, setFiltros] = useState({
    carrera: '',
    sexo: '',
    anioMin: '',
    anioMax: ''
  });

  const alumnoFormRef = useRef(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPreview, setAdminPreview] = useState(null);

  const loadTutores = useCallback(() => {
    setLoading(true);
    setError('');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    fetch(apiUrl('/tutores'), { signal: controller.signal })
      .then(async (res) => {
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          const looksLikeHtml = text.trimStart().startsWith('<');
          throw new Error(
            looksLikeHtml
              ? 'La respuesta fue HTML (no JSON). La API no está respondiendo correctamente en producción.'
              : 'El servidor no devolvió JSON. ¿Está el backend corriendo? (npm start en la raíz del repo, puerto 3001).'
          );
        }
        if (!res.ok) {
          const msg = data.details || data.error || `Error ${res.status}`;
          throw new Error(msg);
        }
        if (!Array.isArray(data)) {
          throw new Error('El servidor no devolvió una lista de tutores.');
        }
        setTutores(data);
        setLoading(false);
      })
      .catch((err) => {
        const isAbort = err.name === 'AbortError';
        const isNetworkError =
          isAbort ||
          err.message === 'Failed to fetch' ||
          err.name === 'TypeError';
        const msg = isAbort
          ? 'La API tardó demasiado en responder. Verificá DATABASE_URL en Vercel y que /api/tutores responda.'
          : isNetworkError
            ? 'No se pudo conectar con el backend. Verificá que el deploy en Vercel incluya la API y que DATABASE_URL esté configurado.'
            : (err.message || 'No se pudo cargar la lista de tutores');
        setError(msg);
        setLoading(false);
      })
      .finally(() => clearTimeout(timeoutId));
  }, []);

  const loadCarreras = useCallback(() => {
    fetch(apiUrl('/carreras'))
      .then(async (res) => {
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          console.warn('No se pudieron cargar carreras: respuesta no JSON. ¿Reiniciaste el backend?');
          return;
        }
        if (!res.ok) {
          console.warn('No se pudieron cargar carreras:', data.error || res.status);
          return;
        }
        if (Array.isArray(data.mentores)) {
          setCarrerasMentor(data.mentores.length > 0 ? data.mentores : []);
        }
        if (Array.isArray(data.alumnos)) {
          setCarrerasAlumno(data.alumnos.length > 0 ? data.alumnos : []);
        }
      })
      .catch((err) => {
        console.warn('No se pudieron cargar carreras:', err.message);
      });
  }, []);

  const refreshAppData = useCallback(() => {
    loadTutores();
    loadCarreras();
  }, [loadTutores, loadCarreras]);

  useEffect(() => {
    refreshAppData();
  }, [refreshAppData]);

function tutorSinCupo(tutor) {
  return (tutor['Cupo disponible'] ?? 0) <= 0;
}

  // Función para filtrar tutores
  const tutoresFiltrados = tutores.filter(tutor => {
    if (filtros.carrera && tutor.Carrera !== filtros.carrera) return false;
    if (filtros.sexo && tutor.Sexo !== filtros.sexo) return false;
    if (filtros.anioMin && parseInt(tutor.Graduación) < parseInt(filtros.anioMin)) return false;
    if (filtros.anioMax && parseInt(tutor.Graduación) > parseInt(filtros.anioMax)) return false;
    return true;
  });

  const handleSelectTutor = (tutor) => {
    if (tutorSinCupo(tutor)) return;
    if (seleccion && seleccion.Nombre === tutor.Nombre && seleccion.Apellido === tutor.Apellido) {
      setSeleccion(null);
    } else {
      setSeleccion(tutor);
      setTimeout(() => {
        if (alumnoFormRef.current) {
          alumnoFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
    setMensaje('');
  };

  const handleChange = e => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleFiltroChange = e => {
    setFiltros({ ...filtros, [e.target.name]: e.target.value });
  };

  const limpiarFiltros = () => {
    setFiltros({ carrera: '', sexo: '', anioMin: '', anioMax: '' });
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (enviando) return;
    setMensaje('');
    if (!seleccion) {
      setMensaje('Por favor, selecciona un tutor.');
      return;
    }
    for (const campo of ['nombre','apellido','anioCarrera','carrera','correo','celular','sexo']) {
      if (!form[campo]) {
        setMensaje('Por favor, completa todos los campos.');
        return;
      }
    }
    if (!isCorreoInstitucional(form.correo)) {
      setMensaje('El correo debe ser institucional (@austral.edu.ar o subdominio, ej. @ing.austral.edu.ar).');
      return;
    }
    setEnviando(true);
    try {
      const res = await fetch(apiUrl('/seleccionar-tutor'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tutor: { Nombre: seleccion.Nombre, Apellido: seleccion.Apellido },
          alumno: form,
        }),
      });
      const { data, ok } = await parseApiResponse(res);
      if (ok && data.ok) {
        setMensaje('¡Selección exitosa! El tutor recibirá tus datos.');
        setSeleccion(null);
        setForm({ nombre: '', apellido: '', anioCarrera: '', carrera: '', correo: '', celular: '', linkedin: '', sexo: '' });
      } else if (data.solicitudPrevia) {
        setMensaje(`Ya tienes una solicitud de tutor registrada el ${data.solicitudPrevia.fecha} con ${data.solicitudPrevia.tutor}. No puedes solicitar otro tutor.`);
      } else {
        setMensaje(apiErrorMessage(data, 'Error al seleccionar tutor.'));
      }
    } catch (err) {
      setMensaje(err.message || 'Error de conexión con el servidor.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className={`main-layout${enviando ? ' main-layout--enviando' : ''}`}>
      <SettingsButton onClick={() => setShowPasswordModal(true)} />
      {showPasswordModal && (
        <PasswordModal
          onClose={() => setShowPasswordModal(false)}
          onSuccess={(password, preview) => {
            setAdminPassword(password);
            setAdminPreview(preview);
            setShowPasswordModal(false);
            setShowAdminPanel(true);
            refreshAppData();
          }}
        />
      )}
      {showAdminPanel && (
        <AdminPanel
          password={adminPassword}
          initialPreview={adminPreview}
          onClose={() => {
            setShowAdminPanel(false);
            setAdminPassword('');
            setAdminPreview(null);
            refreshAppData();
          }}
          onTutoresUpdated={refreshAppData}
        />
      )}
      <div className="tutores-list">
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <img 
            src="/logoGraduados.png" 
            alt="Departamento de Graduados - Facultad de Ingeniería Austral"
            style={{ 
              maxWidth: '300px', 
              height: 'auto',
              marginBottom: '5px'
            }}
          />
        </div>
        <h1>Seleccioná tu Graduado-Mentor</h1>
        <p style={{ color: '#666', marginBottom: 20 }}>Haciendo click en la foto, verás su perfil de LinkedIn</p>
        {loading && <p>Cargando tutores...</p>}
        {error && <p style={{ color: 'red' }}>{error}</p>}
        {!loading && !error && (
          <>
            {/* Filtros */}
            <div style={{ 
              background: '#f5f5f5', 
              padding: 16, 
              borderRadius: 8, 
              marginBottom: 20,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              alignItems: 'end'
            }}>
              <div className="filtro-carrera">
                <label>Carrera:<br/>
                  <select
                    className="select-carrera"
                    name="carrera"
                    value={filtros.carrera}
                    onChange={handleFiltroChange}
                  >
                    <option value="">Todas</option>
                    {carrerasMentor.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
              <div>
                <label>Sexo:<br/>
                  <select name="sexo" value={filtros.sexo} onChange={handleFiltroChange}>
                    <option value="">Todos</option>
                    <option value="Varón">Varón</option>
                    <option value="Mujer">Mujer</option>
                  </select>
                </label>
              </div>
              <div>
                <label>Graduado desde:<br/>
                  <input 
                    name="anioMin" 
                    type="number" 
                    value={filtros.anioMin} 
                    onChange={handleFiltroChange}
                    placeholder="Ej: 2010"
                    style={{ width: 80 }}
                  />
                </label>
              </div>
              <div>
                <label>hasta:<br/>
                  <input 
                    name="anioMax" 
                    type="number" 
                    value={filtros.anioMax} 
                    onChange={handleFiltroChange}
                    placeholder="Ej: 2020"
                    style={{ width: 80 }}
                  />
                </label>
              </div>
              <div>
                <button onClick={limpiarFiltros} style={{ padding: '8px 16px' }}>
                  Limpiar filtros
                </button>
              </div>
            </div>
            {/* Lista de tutores */}
            <div className="tutores-grid">
              {tutoresFiltrados.length === 0 && <p style={{gridColumn: '1 / -1'}}>No hay tutores que coincidan con los filtros.</p>}
              {tutoresFiltrados.map((tutor, idx) => {
                const sinCupo = tutorSinCupo(tutor);
                const seleccionado = seleccion && seleccion.Nombre === tutor.Nombre && seleccion.Apellido === tutor.Apellido;
                return (
                <div
                  key={idx}
                  className={`tutor-card${seleccionado ? ' seleccionado' : ''}${sinCupo ? ' tutor-card--agotado' : ''}`}
                  onClick={() => handleSelectTutor(tutor)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    background: '#fff',
                    border: '1px solid #ddd',
                    borderRadius: 8,
                    marginBottom: 0,
                    padding: 12,
                    cursor: sinCupo ? 'default' : 'pointer',
                    boxShadow: seleccionado ? '0 0 0 2px #1976d2' : 'none',
                  }}
                >
                  <a
                    href={tutor.Linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <img
                      src={normalizeDrivePhotoUrlClient(tutor.Foto) || '/logo192.png'}
                      alt={tutor.Nombre}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        // Ayuda a depurar URLs de fotos que no cargan desde Drive.
                        const img = e.currentTarget;
                        console.error(
                          'Error cargando foto de tutor:',
                          tutor.Nombre,
                          tutor.Apellido,
                          tutor.Foto,
                          'src:',
                          img?.src
                        );

                        // Si falló la URL thumbnail, probamos con uc?export=view.
                        if (img?.src && img.src.includes('drive.google.com/thumbnail')) {
                          const m = img.src.match(/[?&]id=([a-zA-Z0-9_-]+)/);
                          if (m?.[1]) {
                            const fallback = `https://drive.google.com/uc?export=view&id=${m[1]}`;
                            img.onerror = (e2) => {
                              const img2 = e2.currentTarget;
                              img2.onerror = null;
                              img2.src = '/logo192.png';
                            };
                            img.src = fallback;
                            return;
                          }
                        }

                        img.onerror = null;
                        img.src = '/logo192.png';
                      }}
                      style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '2px solid #1976d2' }}
                    />
                  </a>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold', fontSize: 18 }}>{tutor.Nombre} {tutor.Apellido}</div>
                    {sinCupo && <div className="tutor-cupo-agotado">Cupo agotado</div>}
                    <div style={{ color: '#555' }}>{tutor.Carrera}</div>
                    <div style={{ color: '#888', fontSize: 13 }}>Graduación: {tutor.Graduación}</div>
                    {tutor.Cargo && <div style={{ color: '#888', fontSize: 13 }}>Cargo: {tutor.Cargo}</div>}
                    {tutor.Empresa && <div style={{ color: '#888', fontSize: 13 }}>Empresa: {tutor.Empresa}</div>}
                    {tutor.Lugar && <div style={{ color: '#888', fontSize: 13 }}>Lugar: {tutor.Lugar}</div>}
                  </div>
                </div>
              );
              })}
            </div>
          </>
        )}
      </div>
      <div className="alumno-form" ref={alumnoFormRef}>
        <h2>Datos del Alumno</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input name="nombre" value={form.nombre} onChange={handleChange} placeholder="Nombre" />
          <input name="apellido" value={form.apellido} onChange={handleChange} placeholder="Apellido" />
          <input name="anioCarrera" value={form.anioCarrera} onChange={handleChange} placeholder="Año de la carrera" type="number" min="1" max="7" />
          <select className="select-carrera" name="carrera" value={form.carrera} onChange={handleChange}>
            <option value="">Seleccioná tu carrera</option>
            {carrerasAlumno.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input name="correo" value={form.correo} onChange={handleChange} placeholder="Correo electrónico institucional" type="email" />
          <input name="celular" value={form.celular} onChange={handleChange} placeholder="Celular" />
          <input name="linkedin" value={form.linkedin} onChange={handleChange} placeholder="LinkedIn (opcional)" />
          <select name="sexo" value={form.sexo} onChange={handleChange}>
            <option value="">Sexo</option>
            <option value="Varón">Varón</option>
            <option value="Mujer">Mujer</option>
          </select>
          <button
            type="submit"
            disabled={enviando}
            style={{
              padding: '10px 0',
              background: enviando ? '#90caf9' : '#1976d2',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              fontWeight: 'bold',
              fontSize: 16,
              cursor: enviando ? 'wait' : 'pointer',
            }}
          >
            {enviando ? 'Enviando...' : 'Enviar solicitud'}
          </button>
        </form>
        {seleccion && (
          <div style={{ marginTop: 16, background: '#e3f2fd', padding: 10, borderRadius: 8, color: '#1976d2', fontWeight: 'bold', textAlign: 'center' }}>
            Tutor seleccionado: {seleccion.Nombre} {seleccion.Apellido}
          </div>
        )}
        {mensaje && <div style={{ marginTop: 16, color: mensaje.includes('¡Selección exitosa!') ? 'green' : 'red' }}>{mensaje}</div>}
      </div>
    </div>
  );
}

export default App;
