import React, { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import ReportModal from './ReportModal';

mapboxgl.accessToken = "pk.eyJ1IjoieWFzaDE5MTMiLCJhIjoiY21sOWx3bzdhMDRscjNlczlyM3Yzcm1vZiJ9.HnuW9XI--r_uVlNM_IbLdQ";

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  
  const [weather, setWeather] = useState({ 
    rain: 0, temp: '--', humidity: '--', wind: '--', 
    discharge: 5000, risk: 0, source: 'Init' 
  });
  
  const [inspectData, setInspectData] = useState(null);
  const [simulationMode, setSimulationMode] = useState(false);
  const [simRain, setSimRain] = useState(0);
  const [time, setTime] = useState(new Date());
  const [showReport, setShowReport] = useState(false);

  // --- NEW: EVENT LOG SYSTEM ---
  const [logs, setLogs] = useState([{ time: new Date().toLocaleTimeString(), msg: "System Initialized. Connected to Sentinel Node." }]);

  const addLog = (msg) => {
    setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg }, ...prev].slice(0, 50)); // Keep last 50 logs
  };

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Map Initialization (Same as before)
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
            addLog(`Loaded ${bounds.length} LiDAR Tiles from Server.`); // <--- LOGGING
            bounds.forEach((b, i) => {
                map.current.addSource(`tile-${i}`, { 'type': 'geojson', 'data': { 'type': 'Feature', 'geometry': { 'type': 'Polygon', 'coordinates': [b.coords] } } });
                map.current.addLayer({ 'id': `tile-fill-${i}`, 'type': 'fill', 'source': `tile-${i}`, 'paint': { 'fill-color': '#0080ff', 'fill-opacity': 0.1 } });
            });
        });

      map.current.addSource('death-zones', { type: 'geojson', data: '/death_zones.json' });
      map.current.addLayer({
        id: 'death-zones-layer',
        type: 'circle',
        source: 'death-zones',
        paint: {
          'circle-radius': 4,
          'circle-color': ['case', ['>=', ['get', 'riskLevel'], 2], '#ef4444', '#22c55e'], 
          'circle-opacity': 0.3,
          'circle-blur': 0.2 
        }
      });
      addLog("Risk Zones (Death Zones) Layer Active.");
    });

    map.current.on('click', async (e) => {
        const { lng, lat } = e.lngLat;
        setInspectData({ loading: true });
        addLog(`Querying LiDAR at Lat: ${lat.toFixed(4)}...`);
        
        const res = await fetch('http://127.0.0.1:5000/check-location', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat, lon: lng })
        });
        const data = await res.json();
        
        if(data.found) addLog(`Elevation Found: ${data.elevation}m (${data.source})`);
        else addLog("Query Failed: Outside LiDAR Coverage.");

        setInspectData({ found: data.found, elevation: data.elevation, source: data.source, lat: lat.toFixed(4), lng: lng.toFixed(4) });
    });
  }, []);

  // DATA LOOP
  useEffect(() => {
    const fetchLive = async () => {
        try {
            let url = 'http://127.0.0.1:5000/predict-live';
            if (simulationMode) url += `?sim_rain=${simRain}`;

            const res = await fetch(url);
            const data = await res.json();
            
            // LOGGING IMPORTANT CHANGES
            if (data.risk_level !== weather.risk) {
                if(data.risk_level === 2) addLog("⚠️ CRITICAL ALERT: FLOOD THRESHOLD BREACHED!");
                if(data.risk_level === 1) addLog("⚠️ WARNING: Water levels rising.");
                if(data.risk_level === 0) addLog("✅ Status Normalized. Levels receding.");
            }

            setWeather({ 
                rain: data.rainfall, 
                temp: data.temperature,
                humidity: data.humidity,
                wind: data.wind_speed,
                discharge: data.discharge, 
                risk: data.risk_level, 
                source: data.source 
            });

            if(map.current && map.current.getLayer('death-zones-layer')) {
                 map.current.setPaintProperty('death-zones-layer', 'circle-color', 
                    data.risk_level >= 2 ? '#dc2626' : (data.risk_level === 1 ? '#f59e0b' : '#22c55e')
                 );
                 map.current.setPaintProperty('death-zones-layer', 'circle-opacity', 
                    data.risk_level >= 1 ? 0.4 : 0
                 );
            }
        } catch(e) {}
    };
    const interval = setInterval(fetchLive, 1000); 
    return () => clearInterval(interval);
  }, [simulationMode, simRain, weather.risk]); // Added weather.risk to dependency for logging

  return (
    <div style={{ width: "100vw", height: "100vh", fontFamily: '"Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}>
      <div ref={mapContainer} style={{ width: "100%", height: "100%" }} />
      
      {/* --- DASHBOARD --- */}
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
                    addLog(simulationMode ? "Switched to LIVE Data Mode." : "Switched to SIMULATION Mode.");
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

        {/* Simulator Slider */}
        {simulationMode && (
            <div style={{marginBottom:'15px', padding:'10px', background:'rgba(245, 158, 11, 0.1)', borderRadius:'8px', border:'1px dashed #f59e0b'}}>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:'11px', marginBottom:'5px', color:'#fcd34d'}}>
                    <span>Manual Rain Injection</span>
                    <strong>{simRain} mm</strong>
                </div>
                <input 
                    type="range" min="0" max="300" value={simRain} 
                    onChange={(e) => setSimRain(e.target.value)}
                    style={{width:'100%', cursor:'pointer', accentColor: '#f59e0b'}}
                />
            </div>
        )}

        {/* Metrics & Weather (Keep existing code) */}
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

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'15px'}}>
            <div style={{background:'rgba(0,0,0,0.3)', padding:'12px', borderRadius:'12px'}}>
                <span style={{fontSize:'10px', color:'#94a3b8', textTransform:'uppercase'}}>Precipitation</span><br/>
                <div style={{display:'flex', alignItems:'baseline', gap:'4px'}}>
                    <strong style={{fontSize:'24px', color:'#38bdf8', fontWeight:'800'}}>{weather.rain}</strong>
                    <span style={{fontSize:'11px', color:'#38bdf8'}}>mm</span>
                </div>
            </div>
            <div style={{background:'rgba(0,0,0,0.3)', padding:'12px', borderRadius:'12px'}}>
                <span style={{fontSize:'10px', color:'#94a3b8', textTransform:'uppercase'}}>Est. Discharge</span><br/>
                <div style={{display:'flex', alignItems:'baseline', gap:'4px'}}>
                    <strong style={{fontSize:'22px', color:'#fbbf24', fontWeight:'800'}}>{weather.discharge.toLocaleString()}</strong>
                    <span style={{fontSize:'9px', color:'#fbbf24'}}>cusecs</span>
                </div>
            </div>
        </div>

        {/* Status Bar */}
        <div style={{
            background: weather.risk >= 2 ? 'linear-gradient(90deg, #7f1d1d 0%, #991b1b 100%)' : weather.risk === 1 ? '#7c2d12' : 'linear-gradient(90deg, #064e3b 0%, #10b981 100%)',
            padding:'14px', borderRadius:'12px', textAlign:'center', transition:'0.5s',
            boxShadow: weather.risk >= 2 ? '0 0 20px rgba(220, 38, 38, 0.4)' : 'none',
            marginBottom: '15px'
        }}>
            <div style={{fontSize:'9px', color:'rgba(255,255,255,0.8)', letterSpacing:'1px', marginBottom:'2px'}}>CURRENT STATUS</div>
            <strong style={{fontSize:'16px', letterSpacing:'0.5px', textTransform:'uppercase'}}>
                {weather.risk === 0 ? "SAFE CONDITION" : weather.risk === 1 ? "WARNING LEVEL" : "CRITICAL FLOOD ALERT"}
            </strong>
        </div>

        {/* Report Button */}
        <button onClick={() => { setShowReport(true); addLog("Generated PDF Report."); }} style={{ width: '100%', padding: '10px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', marginBottom: '15px' }}>
            📄 GENERATE REPORT
        </button>

        {/* --- NEW: LIVE EVENT LOGS (THE "DATABASE" LOOK) --- */}
        <div style={{ background: '#020617', borderRadius: '8px', padding: '10px', height: '120px', overflowY: 'auto', border: '1px solid #1e293b', fontSize: '10px', fontFamily: 'monospace' }}>
            <div style={{color:'#64748b', marginBottom:'5px', borderBottom:'1px solid #1e293b', paddingBottom:'2px'}}>SYSTEM LOGS (LIVE)</div>
            {logs.map((log, i) => (
                <div key={i} style={{marginBottom:'4px', color: log.msg.includes("CRITICAL") ? '#ef4444' : '#94a3b8'}}>
                    <span style={{color:'#475569'}}>[{log.time}]</span> {log.msg}
                </div>
            ))}
        </div>

      </div>

      {/* Inspector & Report Modal (Keep existing) */}
      {inspectData && inspectData.found && (
        <div style={{ position: 'absolute', top: 20, right: 20, width: '250px', background: 'rgba(0,0,0,0.8)', color: 'white', padding: '16px', borderRadius: '12px', borderLeft: '4px solid #f59e0b' }}>
            <div style={{fontSize:'28px', color:'#4ade80'}}>{inspectData.elevation} m</div>
            <div style={{fontSize:'10px', color:'#aaa'}}>{inspectData.source}</div>
        </div>
      )}

      {showReport && <ReportModal onClose={() => setShowReport(false)} weather={weather} simulationMode={simulationMode} simRain={simRain} />}
    </div>
  );
}

export default App;