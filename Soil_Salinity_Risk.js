// ============================================================================
// POTENTIAL SOIL SALINITY RISK MAPPING
// Google Earth Engine | Sentinel-2 Surface Reflectance
//
// OUTPUTS:
// 1. Sentinel-2 true-colour composite
// 2. Continuous potential soil salinity-risk index
// 3. Five-class potential soil salinity-risk map
// 4. Map title and legend
// 5. 3D pie chart showing area by risk class
// 6. GeoTIFF and CSV exports
//
// IMPORTANT:
// This is a remote-sensing demonstration.
// The output represents potential salinity risk, not field-measured ECe.

//Author: Faiza Msemo
// ============================================================================


// ============================================================================
// 1. USER SETTINGS
// ============================================================================

// Import or draw a LOCAL study-area boundary and rename it "table".
var aoi = table.geometry()
  .dissolve(100)
  .simplify(100);

// Use a relatively dry and cloud-free period.
var startDate = '2025-07-01';
var endDate   = '2025-08-31';

// Maximum acceptable image-level cloud cover.
var maximumCloud = 20;

// Map and export resolution.
var analysisScale = 20;

// Coarser resolution for area statistics.
// This reduces memory and timeout problems.
var statisticsScale = 500;


// Display study area.
Map.centerObject(aoi, 10);

Map.addLayer(
  aoi,
  {
    color: '000000'
  },
  'Study Area Boundary',
  false
);


// Print AOI size for checking.
print(
  'Study area, square kilometres:',
  aoi.area(100).divide(1e6)
);


// ============================================================================
// 2. SENTINEL-2 CLOUD AND SHADOW MASK
// ============================================================================

function maskSentinel2(image) {

  var scl = image.select('SCL');

  // Retain clear pixels.
  var clearMask = scl.neq(1)       // Saturated or defective pixels
    .and(scl.neq(3))               // Cloud shadows
    .and(scl.neq(6))               // Water
    .and(scl.neq(7))               // Low-probability clouds/unclassified
    .and(scl.neq(8))               // Medium-probability clouds
    .and(scl.neq(9))               // High-probability clouds
    .and(scl.neq(10))              // Cirrus
    .and(scl.neq(11));             // Snow or ice

  return image
    .updateMask(clearMask)
    .select(
      [
        'B2',
        'B3',
        'B4',
        'B8',
        'B11',
        'B12'
      ],
      [
        'Blue',
        'Green',
        'Red',
        'NIR',
        'SWIR1',
        'SWIR2'
      ]
    )
    .multiply(0.0001)
    .copyProperties(
      image,
      ['system:time_start']
    );
}


// ============================================================================
// 3. LOAD SENTINEL-2 IMAGERY
// ============================================================================

var sentinel2 = ee.ImageCollection( 'COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(aoi)
  .filterDate(startDate, endDate)
  .filter(
    ee.Filter.lte(
      'CLOUDY_PIXEL_PERCENTAGE',
      maximumCloud
    )
  )
  .map(maskSentinel2);


print(
  'Sentinel-2 image count:',
  sentinel2.size()
);


// Create median composite.
var composite = sentinel2
  .median()
  .clip(aoi);


print(
  'Composite bands:',
  composite.bandNames()
);


// ============================================================================
// 4. TRUE-COLOUR VISUALIZATION
// ============================================================================

Map.addLayer(
  composite,
  {
    bands: [
      'Red',
      'Green',
      'Blue'
    ],
    min: 0.02,
    max: 0.30,
    gamma: 1.2
  },
  'Sentinel-2 True Colour',
  true
);


// ============================================================================
// 5. VEGETATION AND MOISTURE INDICES
// ============================================================================

// Normalized Difference Vegetation Index.
var ndvi = composite
  .normalizedDifference([
    'NIR',
    'Red'
  ])
  .rename('NDVI');


// Normalized Difference Moisture Index.
var ndmi = composite
  .normalizedDifference([
    'NIR',
    'SWIR1'
  ])
  .rename('NDMI');


// Modified Normalized Difference Water Index.
var mndwi = composite
  .normalizedDifference([
    'Green',
    'SWIR1'
  ])
  .rename('MNDWI');


// ============================================================================
// 6. BARE-SOIL AND SALINITY-RELATED INDICES
// ============================================================================

// -----------------------------------------------------------------------------
// 6.1 Bare Soil Index
// -----------------------------------------------------------------------------

var bsi = composite.expression(
  '((SWIR1 + Red) - (NIR + Blue)) / ' +
  '((SWIR1 + Red) + (NIR + Blue) + 0.0001)',
  {
    SWIR1: composite.select('SWIR1'),
    Red: composite.select('Red'),
    NIR: composite.select('NIR'),
    Blue: composite.select('Blue')
  }
).rename('BSI');


// -----------------------------------------------------------------------------
// 6.2 Red-NIR salinity-related index
// -----------------------------------------------------------------------------

var rnsi = composite.expression(
  '(Red - NIR) / (Red + NIR + 0.0001)',
  {
    Red: composite.select('Red'),
    NIR: composite.select('NIR')
  }
).rename('RNSI');


// -----------------------------------------------------------------------------
// 6.3 Salinity Index 1
//
// SI1 = square root of Blue × Red
// -----------------------------------------------------------------------------

var si1 = composite.expression(
  'sqrt(Blue * Red)',
  {
    Blue: composite.select('Blue'),
    Red: composite.select('Red')
  }
).rename('SI1');


// -----------------------------------------------------------------------------
// 6.4 Salinity Index 2
//
// SI2 = square root of Green × Red
// -----------------------------------------------------------------------------

var si2 = composite.expression(
  'sqrt(Green * Red)',
  {
    Green: composite.select('Green'),
    Red: composite.select('Red')
  }
).rename('SI2');


// -----------------------------------------------------------------------------
// 6.5 Shortwave-infrared salinity-related index
// -----------------------------------------------------------------------------

var swirSalinityIndex = composite.expression(
  '(SWIR1 - SWIR2) / (SWIR1 + SWIR2 + 0.0001)',
  {
    SWIR1: composite.select('SWIR1'),
    SWIR2: composite.select('SWIR2')
  }
).rename('SWIR_Salinity_Index');


// ============================================================================
// 7. WATER AND DENSE-VEGETATION MASK
// ============================================================================

// Exclude:
// 1. Open water
// 2. Areas covered by relatively dense vegetation
//
// Salinity is difficult to detect directly beneath dense vegetation.

var analysisMask = mndwi.lt(0.10)
  .and(ndvi.lt(0.45));


// ============================================================================
// 8. NORMALIZE ALL INDICATORS
// ============================================================================

// Fixed normalization is used instead of percentile reduction.
// This substantially reduces Earth Engine processing demand.


// Normalize BSI from approximately -0.5 to 0.5.
var bsiNormalized = bsi
  .unitScale(-0.5, 0.5)
  .clamp(0, 1);


// Normalize RNSI from -1 to 1.
var rnsiNormalized = rnsi
  .unitScale(-1, 1)
  .clamp(0, 1);


// Normalize SI1 from 0 to approximately 0.4.
var si1Normalized = si1
  .unitScale(0, 0.4)
  .clamp(0, 1);


// Normalize SI2 from 0 to approximately 0.4.
var si2Normalized = si2
  .unitScale(0, 0.4)
  .clamp(0, 1);


// Normalize SWIR salinity index from -1 to 1.
var swirNormalized = swirSalinityIndex
  .unitScale(-1, 1)
  .clamp(0, 1);


// Convert NDVI into a low-vegetation indicator.
var lowVegetation = ee.Image.constant(1)
  .subtract(
    ndvi
      .unitScale(-0.2, 0.45)
      .clamp(0, 1)
  )
  .rename('Low_Vegetation');


// Convert NDMI into a low-moisture indicator.
var lowMoisture = ee.Image.constant(1)
  .subtract(
    ndmi
      .unitScale(-0.4, 0.4)
      .clamp(0, 1)
  )
  .rename('Low_Moisture');


// ============================================================================
// 9. COMBINED POTENTIAL SALINITY-RISK INDEX
// ============================================================================

// Demonstration weights:
//
// SI1                  = 20%
// SI2                  = 20%
// Red-NIR index       = 15%
// SWIR index          = 10%
// Bare Soil Index     = 15%
// Low vegetation      = 10%
// Low moisture        = 10%
//
// Total               = 100%

var salinityRisk = si1Normalized
  .multiply(0.20)

  .add(
    si2Normalized.multiply(0.20)
  )

  .add(
    rnsiNormalized.multiply(0.15)
  )

  .add(
    swirNormalized.multiply(0.10)
  )

  .add(
    bsiNormalized.multiply(0.15)
  )

  .add(
    lowVegetation.multiply(0.10)
  )

  .add(
    lowMoisture.multiply(0.10)
  )

  .rename('Potential_Salinity_Risk')
  .updateMask(analysisMask)
  .clip(aoi);


// ============================================================================
// 10. CLASSIFY POTENTIAL SALINITY RISK
// ============================================================================

// Classes:
//
// 1 = Very Low
// 2 = Low
// 3 = Moderate
// 4 = High
// 5 = Very High

var salinityClass = ee.Image.constant(1)

  .where(
    salinityRisk.gt(0.20),
    2
  )

  .where(
    salinityRisk.gt(0.40),
    3
  )

  .where(
    salinityRisk.gt(0.60),
    4
  )

  .where(
    salinityRisk.gt(0.80),
    5
  )

  .rename('Salinity_Risk_Class')
  .updateMask(salinityRisk.mask())
  .toByte();


// ============================================================================
// 11. MAP TITLE
// ============================================================================

var titlePanel = ui.Panel({
  style: {
    position: 'top-center',
    padding: '9px 16px',
    backgroundColor: 'rgba(255,255,255,0.90)'
  }
});


var mainTitle = ui.Label({
  value: 'Potential Soil Salinity Risk Map',
  style: {
    fontSize: '21px',
    fontWeight: 'bold',
    color: '#222222',
    textAlign: 'center',
    margin: '0'
  }
});


var subtitle = ui.Label({
  value: 'Sentinel-2 Surface Reflectance | ' +
    startDate + ' to ' + endDate,
  style: {
    fontSize: '12px',
    color: '#555555',
    textAlign: 'center',
    margin: '4px 0 0 0'
  }
});


var titleDisclaimer = ui.Label({
  value: 'Potential risk indicator — field ECe validation required',
  style: {
    fontSize: '10px',
    fontStyle: 'italic',
    color: '#777777',
    textAlign: 'center',
    margin: '3px 0 0 0'
  }
});


titlePanel.add(mainTitle);
titlePanel.add(subtitle);
titlePanel.add(titleDisclaimer);

Map.add(titlePanel);

// ============================================================================
// 12. MAP VISUALIZATION
// ============================================================================

var salinityPalette = [
  '1a9850',  // Very Low
  '91cf60',  // Low
  'fee08b',  // Moderate
  'fc8d59',  // High
  'd73027'   // Very High
];


// Continuous risk layer.
Map.addLayer(
  salinityRisk,
  {
    min: 0,
    max: 1,
    palette: salinityPalette
  },
  'Continuous Potential Salinity Risk',
  false
);


// Classified risk layer.
Map.addLayer(
  salinityClass,
  {
    min: 1,
    max: 5,
    palette: salinityPalette
  },
  'Potential Soil Salinity Risk Classes',
  true
);


// ============================================================================
// 13. MAP LEGEND
// ============================================================================

var legend = ui.Panel({
  style: {
    position: 'bottom-left',
    padding: '10px 15px',
    backgroundColor: 'rgba(255,255,255,0.90)'
  }
});


legend.add(
  ui.Label({
    value: 'Potential Salinity Risk',
    style: {
      fontSize: '15px',
      fontWeight: 'bold',
      margin: '0 0 8px 0'
    }
  })
);


var legendLabels = [
  'Very Low',
  'Low',
  'Moderate',
  'High',
  'Very High'
];


function addLegendRow(colour, label) {

  var colourBox = ui.Label({
    style: {
      backgroundColor: '#' + colour,
      padding: '8px',
      margin: '0 8px 5px 0'
    }
  });


  var description = ui.Label({
    value: label,
    style: {
      margin: '0 0 5px 0'
    }
  });


  var row = ui.Panel({
    widgets: [
      colourBox,
      description
    ],
    layout: ui.Panel.Layout.Flow('horizontal')
  });


  legend.add(row);
}


for (var i = 0; i < salinityPalette.length; i++) {

  addLegendRow(
    salinityPalette[i],
    legendLabels[i]
  );
}


legend.add(
  ui.Label({
    value: 'Spectral risk indicator; field validation required.',
    style: {
      fontSize: '10px',
      fontStyle: 'italic',
      color: '#666666',
      margin: '8px 0 0 0'
    }
  })
);


Map.add(legend);

// ============================================================================
// 14. AREA STATISTICS — FORCE ALL FIVE CLASSES
// ============================================================================

// Create an image containing:
// Band 1: pixel area in hectares
// Band 2: salinity-risk class

var areaImage = ee.Image.pixelArea()
  .divide(10000)
  .rename('area_ha')
  .addBands(
    salinityClass.rename('class')
  );


// Calculate grouped area statistics.
var areaReduction = areaImage.reduceRegion({
  reducer: ee.Reducer.sum().group({
    groupField: 1,
    groupName: 'class'
  }),

  geometry: aoi,
  scale: statisticsScale,

  bestEffort: true,
  maxPixels: 1e8,
  tileScale: 16
});


// Retrieve grouped results safely.
var groupedResults = ee.List(
  ee.Dictionary(areaReduction).get(
    'groups',
    ee.List([])
  )
);


// Convert grouped results into a dictionary:
//
// Example:
// {
//   "1": 1250,
//   "2": 3400,
//   "4": 820
// }
//
// Missing classes are added later with area = 0.

var areaDictionary = ee.Dictionary(
  groupedResults.iterate(
    function(item, accumulator) {

      item = ee.Dictionary(item);
      accumulator = ee.Dictionary(accumulator);

      var classNumber = ee.Number(
        item.get('class')
      ).toInt();

      var areaHa = ee.Number(
        item.get('sum')
      );

      return accumulator.set(
        classNumber.format(),
        areaHa
      );
    },
    ee.Dictionary({})
  )
);


print(
  'Available class-area dictionary:',
  areaDictionary
);


// -----------------------------------------------------------------------------
// Create all five classes explicitly
// -----------------------------------------------------------------------------

var classNumbers = ee.List.sequence(1, 5);


var classNames = ee.Dictionary({
  '1': 'Very Low',
  '2': 'Low',
  '3': 'Moderate',
  '4': 'High',
  '5': 'Very High'
});


// Build a FeatureCollection containing all five classes.
//
// When a class is absent from the raster, its area is assigned as 0 hectares.

var completeAreaTable = ee.FeatureCollection(
  classNumbers.map(function(classNumber) {

    classNumber = ee.Number(classNumber).toInt();

    var classKey = classNumber.format();

    var areaHa = ee.Number(
      areaDictionary.get(
        classKey,
        0
      )
    );

    return ee.Feature(null, {
      class_number: classNumber,
      risk_class: classNames.get(classKey),
      area_ha: areaHa
    });
  })
);


// Calculate total analysed area.
var totalAnalysedArea = ee.Number(
  completeAreaTable.aggregate_sum('area_ha')
);


// Add percentage values.
//
// The conditional statement prevents division by zero if the analysis mask
// removes every pixel in the AOI.

var areaTable = completeAreaTable.map(function(feature) {

  var areaHa = ee.Number(
    feature.get('area_ha')
  );

  var percentage = ee.Number(
    ee.Algorithms.If(
      totalAnalysedArea.gt(0),
      areaHa
        .divide(totalAnalysedArea)
        .multiply(100),
      0
    )
  );

  return feature.set({
    percentage: percentage,
    area_ha_rounded: areaHa.format('%.2f'),
    percentage_rounded: percentage.format('%.2f')
  });
});


print(
  'All five salinity-risk classes:',
  areaTable.select([
    'class_number',
    'risk_class',
    'area_ha',
    'percentage'
  ])
);


print(
  'Total analysed area, hectares:',
  totalAnalysedArea
);


// ============================================================================
// 15. THREE-DIMENSIONAL PIE CHART — ALL FIVE CLASSES
// ============================================================================

// Google pie charts do not draw a visible slice when its value is exactly zero.
// Therefore, a very small chart-only value is assigned to zero-area classes.
//
// IMPORTANT:
// The actual area and percentage stored in areaTable remain zero.
// chart_area_ha is used only to keep all five categories in the chart legend.

var chartTable = areaTable.map(function(feature) {

  var actualArea = ee.Number(
    feature.get('area_ha')
  );

  var chartArea = ee.Number(
    ee.Algorithms.If(
      actualArea.gt(0),
      actualArea,
      0.000001
    )
  );

  return feature.set({
    chart_area_ha: chartArea
  });
});


var pieChart = ui.Chart.feature.byFeature({
  features: chartTable.sort('class_number'),
  xProperty: 'risk_class',
  yProperties: ['chart_area_ha']
})
.setChartType('PieChart')
.setOptions({

  title: 'Potential Soil Salinity Risk by Area',

  titleTextStyle: {
    fontSize: 17,
    bold: true,
    color: '#222222'
  },

  is3D: true,

  colors: [
    '#1a9850', // Very Low
    '#91cf60', // Low
    '#fee08b', // Moderate
    '#fc8d59', // High
    '#d73027'  // Very High
  ],

  pieSliceText: 'percentage',

  pieSliceTextStyle: {
    fontSize: 11,
    bold: true
  },

  legend: {
    position: 'right',
    alignment: 'center',
    textStyle: {
      fontSize: 12
    }
  },

  tooltip: {
    text: 'both'
  },

  sliceVisibilityThreshold: 0,

  chartArea: {
    left: 20,
    top: 60,
    width: '76%',
    height: '78%'
  },

  width: 700,
  height: 430,

  backgroundColor: {
    fill: '#ffffff',
    stroke: '#dddddd',
    strokeWidth: 1
  }
});


print(pieChart);


// ============================================================================
// 16. EXPORT CONTINUOUS SALINITY-RISK MAP
// ============================================================================

Export.image.toDrive({
  image: salinityRisk,

  description: 'Potential_Soil_Salinity_Risk_Index',

  folder: 'GEE_Soil_Salinity',

  fileNamePrefix:
    'potential_soil_salinity_risk_index',

  region: aoi,

  scale: analysisScale,

  maxPixels: 1e13,

  fileFormat: 'GeoTIFF'
});


// ============================================================================
// 17. EXPORT CLASSIFIED SALINITY-RISK MAP
// ============================================================================

Export.image.toDrive({
  image: salinityClass,

  description:
    'Potential_Soil_Salinity_Risk_Classes',

  folder: 'GEE_Soil_Salinity',

  fileNamePrefix:
    'potential_soil_salinity_risk_classes',

  region: aoi,

  scale: analysisScale,

  maxPixels: 1e13,

  fileFormat: 'GeoTIFF'
});


// ============================================================================
// 18. EXPORT AREA STATISTICS
// ============================================================================

Export.table.toDrive({
  collection: areaTable.select([
    'class_number',
    'risk_class',
    'area_ha',
    'percentage'
  ]),

  description:
    'Potential_Salinity_Risk_Area_Statistics',

  folder: 'GEE_Soil_Salinity',

  fileNamePrefix:
    'potential_salinity_risk_area_statistics',

  fileFormat: 'CSV'
});


// ============================================================================
// 19. FINAL NOTES
// ============================================================================

print(
  'The classified map represents relative potential salinity risk.'
);

print(
  'It does not represent laboratory-measured soil electrical conductivity.'
);

print(
  'Use field ECe samples to calibrate and validate a definitive salinity map.'
);