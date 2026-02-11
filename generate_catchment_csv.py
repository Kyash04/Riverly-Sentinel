import rasterio
import pandas as pd
import numpy as np
from glob import glob
from rasterio.warp import transform
import os

# CONFIGURATION
TILE_FOLDER = "tiles"
RIVER_BED_THRESHOLD = 300.0  # Capture river bed + banks
SAMPLE_STEP = 300 # Step size (Higher = fewer points, faster performance)

data_rows = []
print("Scanning LiDAR for Distributed Catchment Points...")

tif_files = glob(os.path.join(TILE_FOLDER, "*.tif"))

point_id = 0

for tif_path in tif_files:
    try:
        with rasterio.open(tif_path) as ds:
            data = ds.read(1)
            # Finding relevant pixels (low lying areas)
            valid_pixels = np.where((data > 0) & (data < RIVER_BED_THRESHOLD))
            
            rows = valid_pixels[0][::SAMPLE_STEP]
            cols = valid_pixels[1][::SAMPLE_STEP]
            
            if len(rows) > 0:
                xs, ys = rasterio.transform.xy(ds.transform, rows, cols)
                if ds.crs != 'EPSG:4326':
                    lons, lats = transform(ds.crs, 'EPSG:4326', xs, ys)
                else:
                    lons, lats = xs, ys
                
                # Extract Elevation for these points
                # We can't easily vector read elevation from row/col in one go without looping or advanced indexing
                # For a generator script, looping is acceptable
                
                for r, c, lat, lon in zip(rows, cols, lats, lons):
                    elev = float(data[r, c])
                    
                    # DISTRIBUTE DATA LOGIC:
                    # Assign a "Rainfall Weight" based on Elevation
                    # Higher Elevation (Mountains) = Higher Weight (1.2x rain)
                    # Lower Elevation (City) = Normal Weight (1.0x rain)
                    rain_weight = 1.0
                    if elev > 350: rain_weight = 1.2
                    elif elev < 295: rain_weight = 1.0 # River bed
                    
                    # Assign Curve Number (CN) based on location guess
                    # River bed = High CN (90), Banks = Med CN (70)
                    cn_val = 90 if elev < 294 else 70
                    
                    data_rows.append({
                        "id": point_id,
                        "lat": round(lat, 5),
                        "lon": round(lon, 5),
                        "elevation": round(elev, 2),
                        "rain_weight": rain_weight,
                        "cn": cn_val
                    })
                    point_id += 1
    except Exception as e:
        print(f"Skipped {tif_path}: {e}")

# Save to CSV
df = pd.DataFrame(data_rows)
output_path = "frontend/public/catchment_points.csv"
# Also save a copy for backend to read easily
backend_path = "catchment_points.csv"

df.to_csv(output_path, index=False)
df.to_csv(backend_path, index=False)

print(f"Generated {len(df)} Distributed Points.")
print(f"   Saved to: {backend_path} (For Backend)")
print(f"   Saved to: {output_path} (For Frontend Debugging)")