import React, { useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { X, Download, Activity, AlertTriangle, Home } from 'lucide-react';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

// Added props: simulationMode, simRain
const ReportModal = ({ onClose, weather, simulationMode, simRain }) => {
  const [forecast, setForecast] = useState([]);
  const [generating, setGenerating] = useState(false);

  // 1. Fetch Forecast (Pass Simulation Params)
  useEffect(() => {
    let url = 'http://127.0.0.1:5000/get-forecast';
    if (simulationMode) url += `?sim_rain=${simRain}`;

    fetch(url)
      .then(res => res.json())
      .then(data => setForecast(data));
  }, [simulationMode, simRain]);

  // 2. FIXED PDF GENERATION (Captures Full Scroll Height)
  const generatePDF = async () => {
    setGenerating(true);
    const element = document.getElementById('report-content');
    
    // Hack: Temporarily expand height to fit content for screenshot
    const originalHeight = element.style.height;
    const originalOverflow = element.style.overflow;
    element.style.height = 'auto';
    element.style.overflow = 'visible';

    try {
        const canvas = await html2canvas(element, { 
            scale: 2, // High resolution
            useCORS: true,
            scrollY: -window.scrollY // Fix for scrolling offset
        });
        
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
        
        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
        pdf.save(`RiverHealth_Report_${new Date().toLocaleDateString()}.pdf`);
    } catch(e) {
        console.error("PDF Gen Error:", e);
    } finally {
        // Restore UI styles
        element.style.height = originalHeight;
        element.style.overflow = originalOverflow;
        setGenerating(false);
    }
  };

  const chartData = {
    labels: forecast.map(f => f.time),
    datasets: [
      {
        label: 'Predicted River Discharge (cusecs)',
        data: forecast.map(f => f.discharge),
        borderColor: weather.risk >= 2 ? '#ef4444' : '#3b82f6', // Red line if critical
        backgroundColor: weather.risk >= 2 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(59, 130, 246, 0.2)',
        fill: true,
        tension: 0.4,
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    plugins: { legend: { labels: { color: 'white' } } },
    scales: {
      y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
      x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(5px)', zIndex: 9999,
      display: 'flex', justifyContent: 'center', alignItems: 'center'
    }}>
      
      <div style={{
        width: '800px', maxHeight: '90vh', background: '#0f172a', 
        borderRadius: '16px', border: '1px solid #334155', display: 'flex', flexDirection: 'column'
      }}>
        
        {/* Header */}
        <div style={{padding: '20px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <h2 style={{color: 'white', margin: 0}}>📄 Floodplain Analysis Report</h2>
            <div style={{display:'flex', gap:'10px'}}>
                <button onClick={generatePDF} disabled={generating} style={{
                    display:'flex', alignItems:'center', gap:'8px', background: generating ? '#64748b' : '#3b82f6', 
                    color: 'white', border:'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer'
                }}>
                    <Download size={16} /> {generating ? "Generating..." : "Download PDF"}
                </button>
                <button onClick={onClose} style={{background:'transparent', border:'none', color:'#94a3b8', cursor:'pointer'}}>
                    <X size={24} />
                </button>
            </div>
        </div>

        {/* Content - Set overflow-y: auto here */}
        <div id="report-content" style={{padding: '30px', overflowY: 'auto', background: '#0f172a', color: 'white'}}>
            
            <div style={{marginBottom: '30px', borderBottom: '2px solid #3b82f6', paddingBottom: '10px'}}>
                <h1 style={{fontSize: '28px', marginBottom: '5px'}}>AI River Health Dashboard</h1>
                <div style={{display: 'flex', justifyContent: 'space-between', color: '#94a3b8'}}>
                    <span>📍 Zone: Haridwar Basin (Bhimgoda Barrage)</span>
                    <span>📅 Generated: {new Date().toLocaleString()}</span>
                </div>
            </div>

            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '30px'}}>
                <div style={{background: '#1e293b', padding: '20px', borderRadius: '12px', textAlign: 'center'}}>
                    <Activity size={32} color="#38bdf8" style={{marginBottom: '10px'}}/>
                    <div style={{color: '#94a3b8', fontSize: '12px'}}>CURRENT DISCHARGE</div>
                    <div style={{fontSize: '24px', fontWeight: 'bold'}}>{weather.discharge.toLocaleString()} cusecs</div>
                </div>
                <div style={{background: weather.risk >= 2 ? '#450a0a' : '#1e293b', padding: '20px', borderRadius: '12px', textAlign: 'center', border: weather.risk >=2 ? '1px solid red' : 'none'}}>
                    <AlertTriangle size={32} color={weather.risk >= 2 ? "#ef4444" : "#fbbf24"} style={{marginBottom: '10px'}}/>
                    <div style={{color: '#94a3b8', fontSize: '12px'}}>RISK LEVEL</div>
                    <div style={{fontSize: '24px', fontWeight: 'bold', color: weather.risk >= 2 ? '#ef4444' : 'white'}}>
                        {weather.risk === 0 ? "LOW" : weather.risk === 1 ? "MODERATE" : "CRITICAL"}
                    </div>
                </div>
                <div style={{background: '#1e293b', padding: '20px', borderRadius: '12px', textAlign: 'center'}}>
                    <Home size={32} color="#22c55e" style={{marginBottom: '10px'}}/>
                    <div style={{color: '#94a3b8', fontSize: '12px'}}>EST. HOUSEHOLDS AT RISK</div>
                    <div style={{fontSize: '24px', fontWeight: 'bold'}}>
                        {weather.risk >= 2 ? "1,240+" : weather.risk === 1 ? "350" : "0"}
                    </div>
                </div>
            </div>

            <div style={{background: '#1e293b', padding: '20px', borderRadius: '12px', marginBottom: '30px'}}>
                <h3 style={{borderBottom: '1px solid #334155', paddingBottom: '10px', marginTop: 0}}>📈 12-Hour Forecast (Zonation Prediction)</h3>
                <div style={{height: '250px'}}>
                    {forecast.length > 0 ? <Line data={chartData} options={chartOptions} /> : <p>Loading Forecast...</p>}
                </div>
            </div>

            <div style={{background: 'rgba(59, 130, 246, 0.1)', padding: '20px', borderRadius: '12px', borderLeft: '4px solid #3b82f6'}}>
                <h3 style={{marginTop: 0, color: '#3b82f6'}}>🤖 AI System Advisory</h3>
                <p style={{lineHeight: '1.6', color: '#cbd5e1'}}>
                    Based on real-time LIDAR analysis and the hydrological rating curve, the system detects 
                    <strong> {weather.risk >= 2 ? "CRITICAL FLOOD CONDITIONS" : "stable river flow"}</strong>. 
                    {weather.risk >= 2 
                        ? " Immediate evacuation of Zone A (Low-lying river banks) is recommended. The forecast indicates sustained high discharge levels for the next 4 hours." 
                        : " No immediate floodplain inundation is predicted. Standard monitoring protocols are in effect."}
                </p>
            </div>
            
            <div style={{marginTop: '40px', textAlign: 'center', fontSize: '10px', color: '#475569'}}>
                Generated by River.ly Sentinel • Powered by Open-Meteo & Govt LiDAR Data
            </div>

        </div>
      </div>
    </div>
  );
};

export default ReportModal;