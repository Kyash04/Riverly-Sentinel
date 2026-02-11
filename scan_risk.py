#scan_risk.py
import rasterio
import json
import numpy as np
from glob import glob
from rasterio.warp import transform
import os

# CONFIGURATION
TILE_FOLDER = "tiles"
RISK_THRESHOLD = 296.0  # Meters (Elevation of Har Ki Pauri Banks)
SAMPLE_STEP = 100 # Check every 100th point (Optimization for speed)

risk_points = []
print("Scanning LiDAR Geometry for Death Zones...")

tif_files = glob(os.path.join(TILE_FOLDER, "*.tif"))

for tif_path in tif_files:
    try:
        with rasterio.open(tif_path) as ds:
            data = ds.read(1)
            # Find low-lying pixels
            low_areas = np.where((data > 0) & (data < RISK_THRESHOLD))
            
            # Subsample points
            rows = low_areas[0][::SAMPLE_STEP]
            cols = low_areas[1][::SAMPLE_STEP]
            
            if len(rows) > 0:
                # Convert to GPS Coordinates
                xs, ys = rasterio.transform.xy(ds.transform, rows, cols)
                if ds.crs != 'EPSG:4326':
                    lons, lats = transform(ds.crs, 'EPSG:4326', xs, ys)
                else:
                    lons, lats = xs, ys
                
                for lat, lon in zip(lats, lons):
                    risk_points.append([lon, lat])
    except:
        pass

# Save to Frontend Public Folder
output = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "geometry": { "type": "MultiPoint", "coordinates": risk_points }
    }]
}

# SAVE PATH: Adjust if your folder is named differently
with open("frontend/public/death_zones.json", "w") as f:
    json.dump(output, f)

print(f"Found {len(risk_points)} Danger Points. Saved to frontend/public/death_zones.json")