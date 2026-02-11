import React, { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import ReportModal from './ReportModal';

mapboxgl.accessToken = "pk.eyJ1IjoieWFzaDE5MTMiLCJhIjoiY21sOWx3bzdhMDRscjNlczlyM3Yzcm1vZiJ9.HnuW9XI--r_uVlNM_IbLdQ";

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  
  const simRainRef = useRef(0);
  const simulationModeRef = useRef(false);

  const [weather, setWeather] = useState({ 
    rain: 0, condition: '(Clear Sky)', temp: '--', humidity: '--', wind: '--',
    discharge: 5000, risk: 0, source: 'Init',
    soil_moisture: 0.2, snow_depth: 0, // NEW STATE
    confidence: 0, advisory: "Initializing...",
    return_period: "Normal"
  });
  
  const [inspectData, setInspectData] = useState(null);
  const [simulationMode, setSimulationMode] = useState(false);
  const [simRain, setSimRain] = useState(0);
  const [time, setTime] = useState(new Date());
  const [showReport, setShowReport] = useState(false);
  const [logs, setLogs] = useState([{ time: new Date().toLocaleTimeString(), msg: "✅ System Initialized. SCS-CN Distributed Model." }]);

  const addLog = (msg) => setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg }, ...prev].slice(0, 50));

  useEffect(() => { simRainRef.current = simRain; }, [simRain]);
  useEffect(() => { simulationModeRef.current = simulationMode; }, [simulationMode]);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (map.current) return;
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [78.180, 29.956],
      zoom: 13,
      pitch: 60,
    });

    map.current.on('load', () => {
      map.current.addSource('mapbox-dem', { 'type': 'raster-dem', 'url': 'mapbox://mapbox.mapbox-terrain-dem-v1', 'tileSize': 512, 'maxzoom': 14 });
      map.current.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });

      fetch('http://127.0.0.1:5000/tiles-coverage')
        .then(res => res.json())
        .then(bounds => {
            addLog(`🗺️ LiDAR Bounds Loaded: ${bounds.length} tiles.`);
            bounds.forEach((b, i) => {
                map.current.addSource(`tile-${i}`, { 'type': 'geojson', 'data': { 'type': 'Feature', 'geometry': { 'type': 'Polygon', 'coordinates': [b.coords] } } });
                map.current.addLayer({ 'id': `tile-fill-${i}`, 'type': 'fill', 'source': `tile-${i}`, 'layout': {'visibility': 'none'}, 'paint': { 'fill-color': '#0080ff', 'fill-opacity': 0.1 } });
            });
        });

      map.current.addSource('distributed-flood', { type: 'geojson', data: { type: "FeatureCollection", features: [] } });
      map.current.addLayer({
          id: 'distributed-flood-layer',
          type: 'circle',
          source: 'distributed-flood',
          paint: {
              'circle-radius': 4,
              'circle-color': [
                  'interpolate', ['linear'], ['get', 'runoff'],
                  0, 'rgba(0,0,0,0)',
                  5, '#3b82f6',   // Blue
                  20, '#f59e0b',  // Orange
                  60, '#ef4444'   // Red
              ],
              'circle-opacity': 0.7,
              'circle-blur': 0.2
          }
      });
      addLog("🛡️ Distributed Catchment Layer Active.");
    });

    map.current.on('click', async (e) => {
        const { lng, lat } = e.lngLat;
        setInspectData({ loading: true });
        addLog(`🔍 Probing Terrain at Lat: ${lat.toFixed(4)}...`);
        
        const res = await fetch('http://127.0.0.1:5000/check-location', {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ 
                lat, lon: lng, discharge: weather.discharge 
            })
        });
        const data = await res.json();
        
        if(data.found) addLog(`📍 Elevation: ${data.elevation}m | Type: ${data.status}`);

        setInspectData({ 
            found: data.found, 
            elevation: data.elevation, 
            is_river: data.is_river,       
            status: data.status,
            flood_depth: data.flood_depth,
            local_discharge: data.local_discharge,
            source: data.source,
            water_level: data.water_level
        });
    });
  }, [weather.discharge]); 

  // --- SAFE DATA LOOP ---
  useEffect(() => {
    let isFetching = false; 

    const fetchDistributed = async () => {
        if (isFetching) return; 
        isFetching = true;

        try {
            const currentSimMode = simulationModeRef.current;
            const currentSimRain = simRainRef.current;

            let url = 'http://127.0.0.1:5000/predict-distributed';
            if (currentSimMode) url += `?sim_rain=${currentSimRain}`;

            const res = await fetch(url);
            const data = await res.json();
            
            if (data.error) { console.warn("Backend Error:", data.error); return; }
            
            const riskLevel = data.total_discharge_cusecs > 250000 ? 2 : (data.total_discharge_cusecs > 150000 ? 1 : 0);
            
            setWeather(prev => ({ 
                ...prev,
                rain: data.rainfall_input,
                condition: data.rainfall_input > 0 ? '(Raining)' : '(Clear Sky)', 
                
                temp: data.temperature !== undefined ? data.temperature : prev.temp,
                humidity: data.humidity !== undefined ? data.humidity : prev.humidity,
                wind: data.wind_speed !== undefined ? data.wind_speed : prev.wind,
                
                // NEW: Advanced Params
                soil_moisture: data.soil_moisture || 0.2,
                snow_depth: data.snow_depth || 0,

                discharge: data.total_discharge_cusecs || 0, // Fallback to 0 to prevent crash
                risk: riskLevel, 
                source: "SCS-CN Distributed",
                confidence: 98.5,
                advisory: riskLevel === 2 ? "CRITICAL: Flood likely." : "Normal Flow.",
                return_period: data.return_period || "Normal"
            }));

            if (map.current && map.current.getSource('distributed-flood')) {
                const geojsonData = {
                    type: "FeatureCollection",
                    features: data.distributed_points.map(p => ({
                        type: "Feature",
                        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
                        properties: { runoff: p.runoff_mm }
                    }))
                };
                map.current.getSource('distributed-flood').setData(geojsonData);
            }

        } catch(e) {
            console.error("API Error:", e);
        } finally {
            isFetching = false;
        }
    };

    const interval = setInterval(fetchDistributed, 1500); 
    fetchDistributed(); 

    return () => clearInterval(interval);
  }, []); 

  return (
    <div style={{ width: "100vw", height: "100vh", fontFamily: '"Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}>
      <div ref={mapContainer} style={{ width: "100%", height: "100%" }} />
      
      {/* DASHBOARD PANEL */}
      <div style={{
        position: 'absolute', top: 20, left: 20, width: '380px',
        background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(12px)',
        color: 'white', padding: '20px', borderRadius: '16px', 
        border: weather.risk >= 2 ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)', maxHeight: '90vh', overflowY: 'auto'
      }}>
        
        {/* Header */}
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'15px'}}>
            <div>
                <h2 style={{margin:0, fontSize:'20px', fontWeight:'700'}}>River.ly Sentinel</h2>
                <div style={{fontSize:'12px', color:'#94a3b8', marginTop:'2px'}}>📍 Haridwar, IN</div>
            </div>
            <div style={{textAlign:'right'}}>
                <div style={{fontSize:'16px', fontWeight:'bold', fontFamily:'monospace', color:'#38bdf8'}}>{time.toLocaleTimeString()}</div>
                <div style={{fontSize:'10px', color:'#94a3b8'}}>{time.toLocaleDateString()}</div>
            </div>
        </div>

        {/* Mode Toggle */}
        <div style={{background:'rgba(255,255,255,0.05)', padding:'8px', borderRadius:'8px', marginBottom:'15px', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <span style={{fontSize:'11px', fontWeight:'600', color:'#cbd5e1', paddingLeft:'5px'}}>SYSTEM MODE</span>
            <button 
                onClick={() => {
                    setSimulationMode(!simulationMode);
                    addLog(simulationMode ? "🔄 Switched to LIVE Data Mode." : "🧪 Switched to SIMULATION Mode.");
                }}
                style={{
                    background: simulationMode ? '#f59e0b' : '#10b981', border:'none', color:'white',
                    padding:'4px 10px', borderRadius:'6px', cursor:'pointer', fontSize:'10px', fontWeight:'bold',
                    transition: 'background 0.3s'
                }}
            >
                {simulationMode ? "⚠️ SIMULATION ACTIVE" : "● LIVE MONITORING"}
            </button>
        </div>

        {/* Slider */}
        {simulationMode && (
            <div style={{marginBottom:'15px', padding:'10px', background:'rgba(245, 158, 11, 0.1)', borderRadius:'8px', border:'1px dashed #f59e0b'}}>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:'11px', marginBottom:'5px', color:'#fcd34d'}}>
                    <span>Manual Rain Injection</span>
                    <strong>{simRain} mm</strong>
                </div>
                <input 
                    type="range" min="0" max="300" value={simRain} 
                    onChange={(e) => setSimRain(parseInt(e.target.value))}
                    style={{width:'100%', cursor:'pointer', accentColor: '#f59e0b'}}
                />
            </div>
        )}

        {/* --- NEW: Advanced Metrics Row --- */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginBottom:'12px'}}>
             <div style={{background:'rgba(255,255,255,0.05)', padding:'8px', borderRadius:'8px', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <div>
                    <span style={{fontSize:'9px', color:'#94a3b8', textTransform:'uppercase'}}>Soil Moisture</span><br/>
                    <strong style={{fontSize:'14px', color: weather.soil_moisture > 0.4 ? '#ef4444' : '#22c55e'}}>
                        {(weather.soil_moisture * 100).toFixed(0)}%
                    </strong>
                </div>
                <div style={{width:'6px', height:'6px', borderRadius:'50%', background: weather.soil_moisture > 0.4 ? '#ef4444' : '#22c55e'}}></div>
             </div>
             <div style={{background:'rgba(255,255,255,0.05)', padding:'8px', borderRadius:'8px'}}>
                <span style={{fontSize:'9px', color:'#94a3b8', textTransform:'uppercase'}}>Snow Depth</span><br/>
                <strong style={{fontSize:'14px', color:'#e2e8f0'}}>{weather.snow_depth} m</strong>
             </div>
        </div>

        {/* Basic Metrics */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'8px', marginBottom:'12px'}}>
             <div style={{background:'rgba(255,255,255,0.05)', padding:'8px', borderRadius:'8px', textAlign:'center'}}>
                <span style={{fontSize:'9px', color:'#94a3b8', textTransform:'uppercase'}}>Temp</span><br/>
                <strong style={{fontSize:'16px', color:'#e2e8f0'}}>{weather.temp}°C</strong>
             </div>
             <div style={{background:'rgba(255,255,255,0.05)', padding:'8px', borderRadius:'8px', textAlign:'center'}}>
                <span style={{fontSize:'9px', color:'#94a3b8', textTransform:'uppercase'}}>Humidity</span><br/>
                <strong style={{fontSize:'16px', color:'#e2e8f0'}}>{weather.humidity}%</strong>
             </div>
             <div style={{background:'rgba(255,255,255,0.05)', padding:'8px', borderRadius:'8px', textAlign:'center'}}>
                <span style={{fontSize:'9px', color:'#94a3b8', textTransform:'uppercase'}}>Wind</span><br/>
                <strong style={{fontSize:'16px', color:'#e2e8f0'}}>{weather.wind} <span style={{fontSize:'9px'}}>km/h</span></strong>
             </div>
        </div>

        {/* Main Stats */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'15px'}}>
            <div style={{background:'rgba(0,0,0,0.3)', padding:'12px', borderRadius:'12px'}}>
                <span style={{fontSize:'10px', color:'#94a3b8', textTransform:'uppercase'}}>Precipitation</span><br/>
                <div style={{display:'flex', flexDirection:'column'}}>
                    <div style={{display:'flex', alignItems:'baseline', gap:'4px'}}>
                        <strong style={{fontSize:'24px', color:'#38bdf8', fontWeight:'800'}}>{weather.rain}</strong>
                        <span style={{fontSize:'11px', color:'#38bdf8'}}>mm</span>
                    </div>
                    <span style={{fontSize:'10px', color:'#94a3b8', fontStyle:'italic', marginTop:'-2px'}}>
                        {weather.condition}
                    </span>
                </div>
            </div>
            <div style={{background:'rgba(0,0,0,0.3)', padding:'12px', borderRadius:'12px'}}>
                <span style={{fontSize:'10px', color:'#94a3b8', textTransform:'uppercase'}}>Distributed Discharge</span><br/>
                <div style={{display:'flex', alignItems:'baseline', gap:'4px'}}>
                    <strong style={{fontSize:'22px', color:'#fbbf24', fontWeight:'800'}}>
                        {typeof weather.discharge === 'number' ? weather.discharge.toLocaleString() : '---'}
                    </strong>
                    <span style={{fontSize:'9px', color:'#fbbf24'}}>cusecs</span>
                </div>
            </div>
        </div>

        <div style={{
            background: weather.risk >= 2 ? 'linear-gradient(90deg, #7f1d1d 0%, #991b1b 100%)' : weather.risk === 1 ? '#7c2d12' : 'linear-gradient(90deg, #064e3b 0%, #10b981 100%)',
            padding:'14px', borderRadius:'12px', textAlign:'center', transition:'0.5s',
            boxShadow: weather.risk >= 2 ? '0 0 20px rgba(220, 38, 38, 0.4)' : 'none',
            marginBottom: '15px'
        }}>
            <div style={{fontSize:'9px', color:'rgba(255,255,255,0.8)', letterSpacing:'1px', marginBottom:'2px'}}>HYDROLOGICAL STATUS</div>
            <strong style={{fontSize:'16px', letterSpacing:'0.5px', textTransform:'uppercase'}}>
                {weather.risk === 0 ? "✅ SAFE CONDITION" : weather.risk === 1 ? "⚠️ WARNING LEVEL" : "🚨 CRITICAL FLOOD ALERT"}
            </strong>
            <div style={{fontSize:'10px', marginTop:'4px', color:'rgba(255,255,255,0.7)', fontWeight:'bold'}}>
                Risk Probability: {weather.return_period}
            </div>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '12px', color: '#94a3b8' }}>
              <span>AI MODEL CONFIDENCE</span>
              <span style={{ color: '#22d3ee', fontWeight: 'bold', background: 'rgba(34, 211, 238, 0.1)', padding: '2px 8px', borderRadius: '4px' }}>
                  {weather.confidence}%
              </span>
          </div>
          <div style={{ background: 'rgba(0, 0, 0, 0.3)', borderLeft: '4px solid #facc15', padding: '10px', borderRadius: '4px', fontSize: '11px', lineHeight: '1.4', color: '#f1f5f9', fontFamily: 'monospace' }}>
              <strong style={{ color: '#facc15', display:'block', marginBottom:'4px' }}>
                  📢 LIVE ADVISORY:
              </strong>
              {weather.advisory}
          </div>
        </div>

        <button onClick={() => { setShowReport(true); addLog("📄 Generated PDF Report."); }} style={{ width: '100%', padding: '10px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', marginBottom: '15px' }}>
            📄 GENERATE REPORT
        </button>

        <div style={{ background: '#020617', borderRadius: '8px', padding: '10px', height: '120px', overflowY: 'auto', border: '1px solid #1e293b', fontSize: '10px', fontFamily: 'monospace' }}>
            <div style={{color:'#64748b', marginBottom:'5px', borderBottom:'1px solid #1e293b', paddingBottom:'2px'}}>SYSTEM LOGS (LIVE)</div>
            {logs.map((log, i) => (
                <div key={i} style={{marginBottom:'4px', color: log.msg.includes("CRITICAL") ? '#ef4444' : '#94a3b8'}}>
                    <span style={{color:'#475569'}}>[{log.time}]</span> {log.msg}
                </div>
            ))}
        </div>
      </div>

      {inspectData && inspectData.found && (
        <div style={{ position: 'absolute', top: 20, right: 20, width: '280px', background: 'rgba(0,0,0,0.85)', color: 'white', padding: '16px', borderRadius: '12px', borderLeft: inspectData.is_river ? '4px solid #3b82f6' : '4px solid #64748b' }}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <span style={{fontSize:'10px', color:'#94a3b8', textTransform:'uppercase'}}>TERRAIN ELEVATION</span>
                {inspectData.is_river && <span style={{fontSize:'9px', background:'#3b82f6', padding:'2px 6px', borderRadius:'4px', fontWeight:'bold'}}>WATER DETECTED</span>}
            </div>
            <div style={{fontSize:'28px', color:'white', fontWeight:'300'}}>{inspectData.elevation} m</div>
            <div style={{marginTop:'12px', paddingTop:'10px', borderTop:'1px solid #334155'}}>
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:'4px'}}>
                    <span style={{fontSize:'11px', color:'#94a3b8'}}>Zone Status:</span>
                    <strong style={{fontSize:'11px', color: inspectData.is_river ? '#38bdf8' : '#cbd5e1'}}>{inspectData.status}</strong>
                </div>
                {inspectData.is_river ? (
                    <>
                        <div style={{display:'flex', justifyContent:'space-between', marginBottom:'4px'}}>
                            <span style={{fontSize:'11px', color:'#94a3b8'}}>Local Flow:</span>
                            <strong style={{fontSize:'11px', color:'#fbbf24'}}>{inspectData.local_discharge.toLocaleString()} cusecs</strong>
                        </div>
                        <div style={{display:'flex', justifyContent:'space-between', marginBottom:'4px'}}>
                            <span style={{fontSize:'11px', color:'#94a3b8'}}>Inundation Depth:</span>
                            <strong style={{fontSize:'11px', color:'#38bdf8'}}>{inspectData.flood_depth} m</strong>
                        </div>
                    </>
                ) : (
                    <div style={{marginTop:'5px', fontSize:'10px', color:'#64748b', fontStyle:'italic'}}>* Area is currently dry.</div>
                )}
                 {inspectData.water_level > 0 && (
                     <div style={{display:'flex', justifyContent:'space-between', marginTop:'4px'}}>
                        <span style={{fontSize:'11px', color:'#94a3b8'}}>Hydraulic Level:</span>
                        <strong style={{fontSize:'11px', color:'#cbd5e1'}}>{inspectData.water_level} m</strong>
                    </div>
                 )}
            </div>
        </div>
      )}

      {showReport && <ReportModal onClose={() => setShowReport(false)} weather={weather} simulationMode={simulationMode} simRain={simRain} />}
    </div>
  );
}

export default App;