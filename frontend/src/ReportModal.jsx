import React, { useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { X, Download, Activity, AlertTriangle, Users, Thermometer, Droplets, Wind, Waves, Clock, CloudRain } from 'lucide-react';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const ReportModal = ({ onClose, weather, simulationMode, simRain }) => {
  const [forecast, setForecast] = useState([]);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;

    let url = 'http://127.0.0.1:5000/get-forecast';
    if (simulationMode) url += `?sim_rain=${simRain}`;

    fetch(url, { signal })
      .then(res => res.json())
      .then(data => setForecast(data))
      .catch(err => {
          if (err.name !== 'AbortError') console.error("Forecast Error:", err);
      });

    return () => controller.abort();
  }, [simulationMode, simRain]);

  const generatePDF = async () => {
    setGenerating(true);
    const element = document.getElementById('report-content');
    const originalHeight = element.style.height;
    const originalOverflow = element.style.overflow;
    element.style.height = 'auto'; // Expand to full height for PDF
    element.style.overflow = 'visible';

    try {
        const canvas = await html2canvas(element, { 
            scale: 2, 
            useCORS: true,
            scrollY: -window.scrollY,
            backgroundColor: '#0f172a' // Ensure dark background captures correctly
        });
        
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
        
        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
        pdf.save(`RiverHealth_Report_${new Date().toISOString().slice(0,10)}.pdf`);
    } catch(e) {
        console.error("PDF Gen Error:", e);
    } finally {
        element.style.height = originalHeight;
        element.style.overflow = originalOverflow;
        setGenerating(false);
    }
  };

  const chartData = {
    labels: forecast.map(f => f.time),
    datasets: [
      {
        label: 'Discharge Hydrograph (SCS-CN Method)',
        data: forecast.map(f => f.discharge),
        borderColor: weather.risk >= 2 ? '#ef4444' : '#3b82f6',
        backgroundColor: weather.risk >= 2 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(59, 130, 246, 0.2)',
        fill: true,
        tension: 0.4,
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    plugins: { 
        legend: { labels: { color: 'white' } } 
    },
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
        width: '850px', maxHeight: '95vh', background: '#0f172a', 
        borderRadius: '16px', border: '1px solid #334155', display: 'flex', flexDirection: 'column'
      }}>
        
        {/* Modal Header */}
        <div style={{padding: '20px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <h2 style={{color: 'white', margin: 0, display:'flex', alignItems:'center', gap:'10px'}}>
                📄 Comprehensive Situation Report
            </h2>
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

        {/* Report Body */}
        <div id="report-content" style={{padding: '30px', overflowY: 'auto', background: '#0f172a', color: 'white'}}>
            
            {/* Header Section */}
            <div style={{marginBottom: '25px', borderBottom: '2px solid #3b82f6', paddingBottom: '15px', display:'flex', justifyContent:'space-between', alignItems:'flex-end'}}>
                <div>
                    <h1 style={{fontSize: '24px', marginBottom: '5px', margin: 0}}>River.ly Sentinel <span style={{fontSize:'14px', color:'#94a3b8', fontWeight:'normal'}}>| AI-Powered Flood Forecasting</span></h1>
                    <div style={{color: '#94a3b8', fontSize:'12px', marginTop:'5px'}}>📍 Haridwar Basin (Bhimgoda Barrage) • ID: 29.956N, 78.18E</div>
                </div>
                <div style={{textAlign:'right', color:'#cbd5e1', fontSize:'12px'}}>
                    <div><strong>Date:</strong> {new Date().toLocaleDateString()}</div>
                    <div><strong>Time:</strong> {new Date().toLocaleTimeString()}</div>
                </div>
            </div>

            {/* 1. Environmental Conditions Row */}
            <h3 style={{fontSize:'14px', color:'#94a3b8', textTransform:'uppercase', borderLeft:'3px solid #3b82f6', paddingLeft:'10px', marginTop:0}}>Current Environmental Conditions</h3>
            <div style={{display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '25px', marginTop:'10px'}}>
                <div style={{background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px', textAlign: 'center'}}>
                    <Thermometer size={20} color="#fca5a5" style={{marginBottom:'5px'}}/>
                    <div style={{fontSize:'10px', color:'#94a3b8'}}>TEMPERATURE</div>
                    <div style={{fontSize:'16px', fontWeight:'bold'}}>{weather.temp}°C</div>
                </div>
                <div style={{background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px', textAlign: 'center'}}>
                    <Droplets size={20} color="#93c5fd" style={{marginBottom:'5px'}}/>
                    <div style={{fontSize:'10px', color:'#94a3b8'}}>HUMIDITY</div>
                    <div style={{fontSize:'16px', fontWeight:'bold'}}>{weather.humidity}%</div>
                </div>
                <div style={{background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px', textAlign: 'center'}}>
                    <Wind size={20} color="#cbd5e1" style={{marginBottom:'5px'}}/>
                    <div style={{fontSize:'10px', color:'#94a3b8'}}>WIND SPEED</div>
                    <div style={{fontSize:'16px', fontWeight:'bold'}}>{weather.wind} km/h</div>
                </div>
                <div style={{background: weather.soil_moisture > 0.4 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px', textAlign: 'center', border: weather.soil_moisture > 0.4 ? '1px solid #ef4444' : 'none'}}>
                    <CloudRain size={20} color={weather.soil_moisture > 0.4 ? "#ef4444" : "#22c55e"} style={{marginBottom:'5px'}}/>
                    <div style={{fontSize:'10px', color:'#94a3b8'}}>SOIL SATURATION</div>
                    <div style={{fontSize:'16px', fontWeight:'bold'}}>{(weather.soil_moisture * 100).toFixed(0)}%</div>
                </div>
                <div style={{background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px', textAlign: 'center'}}>
                    <Activity size={20} color="#e2e8f0" style={{marginBottom:'5px'}}/>
                    <div style={{fontSize:'10px', color:'#94a3b8'}}>SNOW DEPTH</div>
                    <div style={{fontSize:'16px', fontWeight:'bold'}}>{weather.snow_depth} m</div>
                </div>
            </div>

            {/* 2. Hydrological Impact Grid */}
            <h3 style={{fontSize:'14px', color:'#94a3b8', textTransform:'uppercase', borderLeft:'3px solid #f59e0b', paddingLeft:'10px'}}>Hydrological Impact Assessment</h3>
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px', marginBottom: '25px', marginTop:'10px'}}>
                
                {/* Discharge Box */}
                <div style={{background: '#1e293b', padding: '15px', borderRadius: '12px', display:'flex', alignItems:'center', gap:'15px'}}>
                    <div style={{background:'rgba(59, 130, 246, 0.2)', padding:'10px', borderRadius:'10px'}}>
                        <Waves size={28} color="#3b82f6"/>
                    </div>
                    <div>
                        <div style={{color: '#94a3b8', fontSize: '11px', textTransform:'uppercase'}}>Total Discharge</div>
                        <div style={{fontSize: '22px', fontWeight: 'bold', color:'white'}}>
                            {typeof weather.discharge === 'number' ? weather.discharge.toLocaleString() : '0'} 
                            <span style={{fontSize:'14px', fontWeight:'normal', color:'#94a3b8'}}> cusecs</span>
                        </div>
                        <div style={{fontSize:'11px', color: weather.dam_release > 0 ? '#ef4444' : '#22c55e'}}>
                            Dam Contribution: {weather.dam_release.toLocaleString()} cusecs
                        </div>
                    </div>
                </div>

                {/* Risk Box */}
                <div style={{background: weather.risk >= 2 ? '#450a0a' : '#1e293b', padding: '15px', borderRadius: '12px', display:'flex', alignItems:'center', gap:'15px', border: weather.risk >= 2 ? '1px solid #ef4444' : '1px solid #334155'}}>
                    <div style={{background: weather.risk >= 2 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.1)', padding:'10px', borderRadius:'10px'}}>
                        <AlertTriangle size={28} color={weather.risk >= 2 ? "#ef4444" : "#fbbf24"}/>
                    </div>
                    <div>
                        <div style={{color: '#94a3b8', fontSize: '11px', textTransform:'uppercase'}}>Risk Probability</div>
                        <div style={{fontSize: '18px', fontWeight: 'bold', color: weather.risk >= 2 ? '#ef4444' : 'white'}}>
                            {weather.return_period}
                        </div>
                        <div style={{fontSize:'11px', color: '#94a3b8'}}>
                            Based on Gumbel Distribution
                        </div>
                    </div>
                </div>

                {/* Impact Box */}
                <div style={{background: '#1e293b', padding: '15px', borderRadius: '12px', display:'flex', alignItems:'center', gap:'15px'}}>
                    <div style={{background:'rgba(16, 185, 129, 0.2)', padding:'10px', borderRadius:'10px'}}>
                        <Users size={28} color="#34d399"/>
                    </div>
                    <div>
                        <div style={{color: '#94a3b8', fontSize: '11px', textTransform:'uppercase'}}>Population at Risk</div>
                        <div style={{fontSize: '22px', fontWeight: 'bold', color:'white'}}>
                            {weather.impact_people.toLocaleString()}
                        </div>
                        <div style={{fontSize:'11px', color: '#fbbf24'}}>
                            Peak Lag Time: {weather.lag_time_hours} hours
                        </div>
                    </div>
                </div>
            </div>

            {/* 3. Hydrograph */}
            <div style={{background: '#1e293b', padding: '20px', borderRadius: '12px', marginBottom: '25px'}}>
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:'10px'}}>
                    <h3 style={{margin:0, fontSize:'14px', color:'white'}}>📈 12-Hour Forecast Hydrograph</h3>
                    <span style={{fontSize:'11px', color:'#94a3b8'}}>Model: SCS-CN + Kinematic Wave</span>
                </div>
                <div style={{height: '250px'}}>
                    {forecast.length > 0 ? <Line data={chartData} options={chartOptions} /> : <p>Loading Forecast...</p>}
                </div>
            </div>

            {/* 4. AI Analysis Text */}
            <div style={{background: 'rgba(59, 130, 246, 0.1)', padding: '20px', borderRadius: '12px', borderLeft: '4px solid #3b82f6'}}>
                <h3 style={{marginTop: 0, color: '#3b82f6', display:'flex', alignItems:'center', gap:'8px'}}>
                    🤖 AI Strategic Analysis
                </h3>
                <p style={{lineHeight: '1.6', color: '#cbd5e1', fontSize:'13px', margin:0}}>
                    <strong>situation Overview:</strong> The basin is currently experiencing {weather.rain}mm of rainfall. 
                    Soil moisture sensors indicate a saturation level of <strong>{(weather.soil_moisture * 100).toFixed(0)}%</strong>, which {weather.soil_moisture > 0.4 ? "significantly increases runoff potential." : "is within safe absorption limits."}
                    <br/><br/>
                    <strong>Forecast & Action:</strong> The predictive model anticipates a <strong>{weather.return_period}</strong>. 
                    With a calculated lag time of <strong>{weather.lag_time_hours} hours</strong>, peak flood waters will reach the barrage shortly.
                    {weather.risk >= 2 
                        ? " IMMEDIATE ACTION REQUIRED: Evacuate low-lying zones. The upstream dam has initiated emergency release protocols." 
                        : " Status is currently stable. Maintain routine surveillance of embankments."}
                </p>
            </div>
            
            <div style={{marginTop: '30px', textAlign: 'center', fontSize: '10px', color: '#475569', borderTop:'1px solid #334155', paddingTop:'10px'}}>
                Generated by River.ly Sentinel • Data Sources: Open-Meteo (ERA5), NASA SMAP, Govt LiDAR • System ID: RIV-2026-X9
            </div>

        </div>
      </div>
    </div>
  );
};

export default ReportModal;