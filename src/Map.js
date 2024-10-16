import React, {useCallback, useEffect, useRef, useState} from "react";
import MapView from "@arcgis/core/views/MapView";
import Map from "@arcgis/core/Map";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import Graphic from "@arcgis/core/Graphic";
import PictureMarkerSymbol from "@arcgis/core/symbols/PictureMarkerSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import SimpleRenderer from "@arcgis/core/renderers/SimpleRenderer";
import DefaultUI from "@arcgis/core/views/ui/DefaultUI";
import Zoom from "@arcgis/core/widgets/Zoom";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import Point from "@arcgis/core/geometry/Point";
import Papa from "papaparse";
import "bootstrap/dist/css/bootstrap.css";
import "bootstrap/dist/css/bootstrap.min.css";
import {Button, Card, Collapse, ListGroup} from "react-bootstrap";

function MapComponent() {
   // Riferimenti alla mappa e alla posizione dell'utente
   const mapRef = useRef(null);
   const mapViewRef = useRef(null);
   const userLocationLayerRef = useRef(new GraphicsLayer({ id: "userLocationLayer" }));
   const userMarkerRef = useRef(null);
   const canClickMapRef = useRef(false);

   // Stato per mostrare la posizione dell'utente
   const [userLocation, setUserLocation] = useState(null);
   const [isLocationVisible, setIsLocationVisible] = useState(false);

   const [animationGraphicsLayer, setAnimationGraphicsLayer] = useState(null);

   // stato per mostrare il layer con tutte le fermata
   const [allStops, setAllStops] = useState(false);
   const [activeShapes, setActiveShapes] = useState([]);

   const [tripsToConsider, setTripsToConsider] = useState([]);

   const [validTrips, setValidTrips] = useState({});
   const [validTripsId, setValidTripsId] = useState([]);
   const [enrichedTrip, setEnrichedTrip] = useState({}); // stato che mi raggruppa stessi numeri di linea
   const [noLinesFound, setNoLinesFound] = useState(false);

   const [selectedRouteShortName, setSelectedRouteShortName] = useState(null); // stato per capire quale numero di linea è selezionato
   const [longNameOptions, setLongNameOptions] = useState([]); // stato per capire da dove uno parte (successivo al numero di linea selezionato)
   const [selectedLongNames, setSelectedLongNames] = useState(new Set());

   // Stati per memorizzare il contenuto dei file Actv
   const [tripsData, setTripsData] = useState([]);
   const [stopTimesData, setStopTimesData] = useState([]);
   const [routesData, setRoutesData] = useState([]);
   const [stopsData, setStopsData] = useState([]);
   const [shapesData, setShapesData] = useState([]);

   // stati per impostare i marker di arrivo e fine
   const [startPoint, setStartPoint] = useState(null);
   const [endPoint, setEndPoint] = useState(null);

   const [currentTime, setCurrentTime] = useState(getCurrentTime());

   function getCurrentTime() {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      return `${hours}:${minutes}`; // HH:MM
   }

   // quando cambio l'orario resetto tutto e rimuovo tutto quello presente sulla mappa
   const handleTimeChange = (event) => {
      const view = mapViewRef.current;

      if (view) {
         setValidTrips({});
         setEnrichedTrip({});
         setSelectedRouteShortName(null);
         setLongNameOptions([]);
         setSelectedLongNames(new Set());
         setValidTripsId([]);

         animationGraphicsLayer.removeAll();
         view.graphics.removeAll();

         const stopsLayer = view.map.findLayerById("stopsFeatureLayer");
         if (stopsLayer) {
            stopsLayer.visible = false;
         }

         const linesLayer = view.map.findLayerById("linesFeatureLayer");
         if (linesLayer) {
            linesLayer.visible = false;
         }
      }
      setCurrentTime(event.target.value);
   };

   // funzione per inizializzare la mappa: basemap, centrata su venezia e i 2 layer principali, fermate e rotte
   const initializeMap = useCallback(async () => {
      if (mapViewRef.current) return;

      const map = new Map({
         basemap: "streets-navigation-vector",
      });

      const view = new MapView({
         container: mapRef.current,
         map: map,
         center: [12.335963387662531, 45.437988034633435], // Coordinates for Venice
         zoom: 12,
         ui: new DefaultUI({
            components: [],
         }),
         popup: {
            dockEnabled: false, // impostato a falso così da usare css custom per i popup
         },
      });
      const zoomWidget = new Zoom({
         view: view,
      });

      // Add the Zoom widget to the top-right corner
      view.ui.add(zoomWidget, "top-right");

      mapViewRef.current = view;

      await view.when();

      view.map.add(userLocationLayerRef.current);

      const graphicsLayer = new GraphicsLayer();
      view.map.add(graphicsLayer);
      setAnimationGraphicsLayer(graphicsLayer);

      // immagine personalizzata per visualizzare le rotte
      const customLineSymbol = new SimpleLineSymbol({
         color: [128, 0, 128],
         width: 1.5,
      });

      const linesRenderer = new SimpleRenderer({
         symbol: customLineSymbol,
      });

      // layer contenente tutte le rotte (shapes)
      const linesUrl =
         "https://services7.arcgis.com/BEVijU9IvwRENrmx/arcgis/rest/services/combined_output/FeatureServer/0";
      const linesFeatureLayer = new FeatureLayer({
         url: linesUrl,
         id: "linesFeatureLayer",
         title: "Mostra tutte le linee",
         visible: false,
         renderer: linesRenderer,
      });
      map.add(linesFeatureLayer);

      // immagine personalizzata per visualizzare le fermate
      const customSymbol = new PictureMarkerSymbol({
         url: "/stop.png",
         width: "16px",
         height: "16px",
      });
      const stopsRenderer = new SimpleRenderer({
         symbol: customSymbol,
      });
      const popupTemplate = {
         title: "{stop_name}",
      };

      // layer contenente tutte le fermate (stops)
      const stopsUrl =
         "https://services7.arcgis.com/BEVijU9IvwRENrmx/arcgis/rest/services/combined_output/FeatureServer/1";
      const stopsFeatureLayer = new FeatureLayer({
         url: stopsUrl,
         id: "stopsFeatureLayer",
         title: "Mostra tutte le fermate",
         visible: allStops,

         renderer: stopsRenderer,
         popupTemplate: popupTemplate,
      });

      map.add(stopsFeatureLayer);

      // modificato l'ordine così che ci sia una buona sovrapposizione
      map.reorder(linesFeatureLayer, 0);
      map.reorder(stopsFeatureLayer, 1);

      // funzione per lasciare l'utente scegliere la sua posizione attuale
      const handleClick = (event) => {
         if (canClickMapRef.current) {
            const { mapPoint } = event;

            // Rimuove il marker della posizione (se già presente)
            if (userMarkerRef.current) {
               userLocationLayerRef.current.remove(userMarkerRef.current);
               view.graphics.remove(userMarkerRef.current);
               userMarkerRef.current = null;
            }

            const newMarker = new Graphic({
               geometry: mapPoint,
               symbol: new PictureMarkerSymbol({
                  url: "/pin.png",
                  width: "36px",
                  height: "36px",
               }),
            });

            // imposto il punto come posizione dell'utente
            view.graphics.add(newMarker);
            userMarkerRef.current = newMarker;
            setUserLocation({
               latitude: mapPoint.latitude,
               longitude: mapPoint.longitude,
            });

            if (userLocationLayerRef.current) {
               userLocationLayerRef.current.removeAll();
               userLocationLayerRef.current.add(newMarker);
            }

            // 1 click al massimo disponibile per ogni volta che voglio impostare la posizione
            canClickMapRef.current = false;
         }
      };

      view.on("click", handleClick);

      // cleanup (?)
      return () => {
         if (view) {
            view.off("click", handleClick);
            view.destroy();
            mapViewRef.current = null;
         }
      };
   }, [allStops]);

   useEffect(() => {
      initializeMap();
   }, [initializeMap]);

   // funzione per ottenere la posizione dell'utente
   const toggleUserLocation = () => {
      const view = mapViewRef.current;
      if (!view) return;

      if (isLocationVisible) {
         if (userLocationLayerRef.current) {
            userLocationLayerRef.current.removeAll();
         }
         setUserLocation(null);
         setIsLocationVisible(false);
         canClickMapRef.current = false;
      } else {
         ShowUserLocation()
            .then((location) => {
               setUserLocation(location);
               setIsLocationVisible(true);
               canClickMapRef.current = false;
            })
            .catch((error) => {
               console.error("Errore nella posizione:", error);
            });
      }
   };

   // funzione per poter premere sulla mappa, e poter impostare la posizione attuale dove si vuole
   const enableMapClick = () => {
      const view = mapViewRef.current;
      if (!view) return;

      if (userLocationLayerRef.current) {
         userLocationLayerRef.current.removeAll();
      }

      setUserLocation(null);
      setIsLocationVisible(false);
      canClickMapRef.current = true;
   };

   const clearUserLocationLayer = () => {
      if (userLocationLayerRef.current) {
         userLocationLayerRef.current.removeAll();
         setUserLocation(null);
         setIsLocationVisible(false);
      }

      if (mapViewRef.current) {
         mapViewRef.current.graphics.removeAll();
         userMarkerRef.current = null;
      }
   };

   // funzione per prendere la posizione dell'utente
   const ShowUserLocation = () => {
      return new Promise((resolve, reject) => {
         if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(
               (position) => {
                  const { latitude, longitude } = position.coords;
                  const newLocation = { latitude, longitude };

                  const view = mapViewRef.current;
                  if (!view) return;

                  const point = {
                     type: "point",
                     longitude: longitude,
                     latitude: latitude,
                  };

                  const markerSymbol = {
                     type: "picture-marker",
                     url: "/pin.png",
                     width: "36px",
                     height: "36px",
                  };

                  const userLocationGraphic = new Graphic({
                     geometry: point,
                     symbol: markerSymbol,
                  });

                  if (userLocationLayerRef.current) {
                     userLocationLayerRef.current.removeAll();
                     mapViewRef.current.graphics.removeAll();
                     userLocationLayerRef.current.add(userLocationGraphic);
                  }

                  resolve(newLocation);
               },
               (error) => {
                  console.error("Error retrieving user location:", error);
                  alert(
                     "Unable to retrieve your location. Please make sure location access is enabled."
                  );
                  reject(error);
               },
               {
                  enableHighAccuracy: true,
                  timeout: 5000,
                  maximumAge: 0,
               }
            );
         } else {
            alert("Geolocation is not supported by your browser.");
            reject(new Error("Geolocation not supported"));
         }
      });
   };

   // Funzione per caricare i file ACTV da cui prendere i dati
   const fetchAndParseCsv = async (filePath) => {
      const response = await fetch(filePath);
      if (!response.ok) {
         throw new Error(
            `Impossibile leggere ${filePath}. Stato: ${response.status} - ${response.statusText}`
         );
      }

      const text = await response.text();
      if (!text) {
         throw new Error(`Testo in ${filePath} vuoto`);
      }

      return Papa.parse(text, {
         header: true,
         skipEmptyLines: true,
         transformHeader: (header) => header.trim(),
         transform: (value) => value.trim(),
      }).data;
   };

   // Funzione per scaricare i dati
   const fetchData = useCallback(async () => {
      try {
         const trips = await fetchAndParseCsv("/actv_nav_583/trips.txt");
         const routes = await fetchAndParseCsv("/actv_nav_583/routes.txt");
         const stops = await fetchAndParseCsv("/actv_nav_583/stops.txt");
         const shapes = await fetchAndParseCsv("/actv_nav_583/shapes.txt");
         const stopTimes = await fetchAndParseCsv("/actv_nav_583/stop_times.txt");

         setTripsData(trips);
         setRoutesData(routes);
         setStopsData(stops);
         setShapesData(shapes);
         setStopTimesData(stopTimes);
      } catch (error) {
         console.error("Errore nel leggere i dati:", error);
      }
   }, []);

   useEffect(() => {
      fetchData();
   }, [fetchData]);

   // Funzione per centrare la visuale in base alla linea selezionata
   const centerMapOnShapes = async (shapeIds) => {
      const mapView = mapViewRef.current;
      const featureLayer = mapView.map.findLayerById("linesFeatureLayer");

      // caso in cui non si è selezionato nulla centro la visuale su Venezia
      if (shapeIds.length === 0) {
         mapView.goTo(
            {
               center: [12.335963387662531, 45.437988034633435],
               zoom: 13,
            },
            {
               duration: 1000,
               easing: "ease-in-out",
            }
         );
         return;
      }

      const query = featureLayer.createQuery();
      query.where = shapeIds.map((id) => `shape_id = '${id}'`).join(" OR ");
      query.returnGeometry = true;

      try {
         const result = await featureLayer.queryFeatures(query);
         if (result.features.length > 0) {
            const extent = result.features.reduce((acc, feature) => {
               return acc.union(feature.geometry.extent);
            }, result.features[0].geometry.extent);

            mapView.goTo(extent.expand(1.5), {
               duration: 1000,
               easing: "ease-in-out",
            });
         }
      } catch (error) {
         console.error("Errore", error);
      }
   };

   // raggruppo i dati di "stopTimesData" in base al trip_id
   const groupStopTimesByTrip = (stopTimesData) => {
      return stopTimesData.reduce((acc, row) => {
         if (!acc[row.trip_id]) {
            acc[row.trip_id] = {
               trip_id: row.trip_id,
               stop_times: [],
               first_arrival_time: row.arrival_time,
               last_departure_time: row.departure_time,
            };
         }
         acc[row.trip_id].stop_times.push(row);

         // per ciascun trip prendo l'orario di arrivo "più presto" e l'orario di partenza "più tardi"
         if (row.arrival_time < acc[row.trip_id].first_arrival_time) {
            acc[row.trip_id].first_arrival_time = row.arrival_time;
         }

         if (row.departure_time > acc[row.trip_id].last_departure_time) {
            acc[row.trip_id].last_departure_time = row.departure_time;
         }

         return acc;
      }, {});
   };

   // funzione per capire il giorno di servizio in base al giorno della settimana
   const getServiceIdForDay = (day) => {
      const serviceIdMap = {
         0: "470503_000",
         1: "470504_000",
         2: "470505_000",
         3: "470505_000",
         4: "470506_000",
         5: "470501_000",
         6: "470502_000",
      };
      return serviceIdMap[day];
   };

   // funzione che aggiunge a ciascun "trip" 2 informazioni prese da "route": route_short_name e route_long_name
   const enrichTripsWithShortAndLongName = (trips, routes) => {
      // Mappo a ciascun route_id il rispettivo route_short_name e route_long_name usando una mappa
      const routeMap = routes.reduce((map, route) => {
         map[route.route_id] = {
            route_short_name: route.route_short_name,
            route_long_name: route.route_long_name,
         };
         return map;
      }, {});

      // A ciascun trip trovo la chiave corrispondente nell'oggetto appena creato e ci aggiungo le informazioni
      return trips.map((trip) => {
         const routeInfo = routeMap[trip.route_id] || {};
         return {
            ...trip,
            route_short_name: routeInfo.route_short_name || "N/A",
            route_long_name: routeInfo.route_long_name || "N/A",
         };
      });
   };

   // funzione che raggruppa i "trip" in base al "route_id"
   const groupTripsByRouteId = (trips) => {
      return trips.reduce((groups, trip) => {
         const { route_short_name } = trip;
         if (!groups[route_short_name]) {
            groups[route_short_name] = [];
         }
         groups[route_short_name].push(trip);
         return groups;
      }, {});
   };

   // funzione che mi raccoglie i "trip" validi al momento corrente basandosi sul giorno di servizio e sull'orario
   const getCurrentTrip = useCallback(() => {
      const filterValidTripsByTime = (
         stopTimesByTrip,
         currentTimeInMinutes
      ) => {
         return Object.values(stopTimesByTrip)
            .filter((trip) => {
               const firstArrivalInMinutes = timeToMinutes(
                  trip.first_arrival_time
               );
               const lastDepartureInMinutes = timeToMinutes(
                  trip.last_departure_time
               );
               return (
                  currentTimeInMinutes > firstArrivalInMinutes &&
                  currentTimeInMinutes < lastDepartureInMinutes
               );
            })
            .map((trip) => trip.trip_id);
      };

      // NOTA: gli orari notturni sono segnati come 25:00, 26:00..., per ottenere risulati validi sottraiamo 24
      const timeToMinutes = (time) => {
         let [hours, minutes] = time.split(":").map(Number);
         if (hours >= 24) {
            hours -= 24;
         }
         return hours * 60 + minutes; // convertiamo tutto in miunuti
      };

      const now = new Date();
      const currentDay = now.getDay();

      const currentTimeInMinutes = timeToMinutes(currentTime);
      const serviceId = getServiceIdForDay(currentDay);

      // prendo i "trip_id" in base al giorno di servizio corrente
      const tripsForServiceId = tripsData
         .filter((trip) => trip.service_id === serviceId)
         .map((trip) => trip.trip_id);

      // prendo solo le fermate attive per i Trip attivi in base al giorno corrente
      const stopTimesForServiceId = stopTimesData.filter(
         (stopTime) => tripsForServiceId.includes(stopTime.trip_id)
      );

      // genera un oggetto che associa ogni trip_id a un array di stop_times corrispondenti
      const stopTimesByTripId = groupStopTimesByTrip(stopTimesForServiceId);

      // trip validi sia per giorno di servizio che per orario del giorno (contiene solo trip_id)
      const validTripIds = filterValidTripsByTime(
          stopTimesByTripId,
          currentTimeInMinutes
      );
      setValidTripsId(validTripIds);

      // trip validi sia per giorno di servizio che per orario del giorno (contiene tutta la riga)
      const validTrips = tripsData.filter((trip) =>
          validTripIds.includes(trip.trip_id)
      );

      // dei trip_id doppioni ne prendo solo la prima occorrenza
      const firstTripsPerRoute = Object.values(
         validTrips.reduce((acc, trip) => {
            if (!acc[trip.route_id]) {
               acc[trip.route_id] = trip;
            }
            return acc;
         }, {})
      );

      // arricchisco i dati con ulteriori info: route_short_name e route_long_name (no doppioni)
      const uniqueEnrichedTrips = enrichTripsWithShortAndLongName(firstTripsPerRoute, routesData);

      // arricchisco i dati con ulteriori info: route_short_name e route_long_name (doppioni)
      const allEnrichedTrips = enrichTripsWithShortAndLongName(validTrips, routesData);

      const enrichedTripsByRoute = groupTripsByRouteId(allEnrichedTrips);
      setValidTrips(enrichedTripsByRoute);

      const validTripsByRoute = groupTripsByRouteId(uniqueEnrichedTrips);
      setEnrichedTrip(validTripsByRoute);

   }, [tripsData, stopTimesData, routesData, currentTime]);

   useEffect(() => {
      getCurrentTrip();
   }, [currentTime, getCurrentTrip]);

   // funzione  che converte una stringa di tipo 'Time' a un oggetto di tipo 'Date'
   const timeToDate = (timeStr) => {
      const [hours, minutes] = timeStr.split(":").map(Number);
      const date = new Date();
      date.setHours(hours, minutes, 0, 0);

      return date;
   };

   // ritorna gli stop_id (le fermate) che fa un trip, serve per poter filtrare le fermate e mostrare solo quelle che servono
   const getStopIdsByTripId = (trip_id, stopTimesData) => {
      return stopTimesData
         .filter((row) => row.trip_id === trip_id)
         .map((row) => row.stop_id);
   };

   // funzione che processa i trip e la shape attiva in questo momento
   const processStopsAndShapes = (
       tripsToConsider,
       stopTimesData,
       stopsData,
       shapesData,
       shapeAttive,
       currentTime
   ) => {
      // Step 1: filtra stop_times dal loro trip_id
      const tripIds = tripsToConsider.map((trip) => trip.trip_id);
      const stopTimesForTripIds = stopTimesData.filter((stopTime) => // tutte le fermate che fa quel trip
         tripIds.includes(stopTime.trip_id)
      );

      // Step 2: prendi le info delle fermate
      const getStopDetails = (stopId) =>
         stopsData.find((stop) => stop.stop_id === stopId);

      // Step 3: prendi l'ultima fermata effettuata dal trip e l'ultima fermata del suo viaggio
      const stopsWithDetails = tripIds.map((tripId) => {
         const stopsForTrip = stopTimesForTripIds.filter(
            (stop) => stop.trip_id === tripId
         );

         let lastStop = null;
         let nextStop = null;

         for (let i = 0; i < stopsForTrip.length; i++) {
            const stop = stopsForTrip[i];
            if (stop.arrival_time <= currentTime) {
               lastStop = stop;
            }
         }

         // Assign the last element of the stopsForTrip array as the next stop
         nextStop = stopsForTrip[stopsForTrip.length - 1];

         const lastStopDetails = lastStop
            ? getStopDetails(lastStop.stop_id)
            : null;
         const nextStopDetails = nextStop
            ? getStopDetails(nextStop.stop_id)
            : null;

         return {
            tripId,
            lastStop: { ...lastStop, ...lastStopDetails },
            nextStop: { ...nextStop, ...nextStopDetails },
         };
      });

      if (!Array.isArray(shapeAttive) || shapeAttive.length === 0) {
         console.error("Nessuna rotta attiva");
         return { newStops: stopsWithDetails, shapesByTripId: {} };
      }

      // Step 4: individuiamo quale shape filtrare e mostrare di conseguenza
      const activeShapes = new Set(shapeAttive);
      const shapeId = shapesData.filter((shape) =>
          activeShapes.has(shape.shape_id)
      );

      const stopsWithShapeInfo = stopsWithDetails.map((stop) => {
         const lastStop = stop.lastStop;
         const nextStop = stop.nextStop;

         const lastStopShape = shapeId.find(
            (shape) =>
               parseFloat(shape.shape_pt_lat) ===
                  parseFloat(lastStop.stop_lat) &&
               parseFloat(shape.shape_pt_lon) === parseFloat(lastStop.stop_lon)
         );

         const nextStopShape = shapeId
             .slice() // copio l'array per non modificarlo direttamente
             .reverse() // Inverto l'array
             .find(
                 (shape) => // per gestire il caso in cui l'inizio e la fine siano nella stessa fermata
                     parseFloat(shape.shape_pt_lat) === parseFloat(nextStop.stop_lat) &&
                     parseFloat(shape.shape_pt_lon) === parseFloat(nextStop.stop_lon)
             );

         return {
            ...stop,
            lastStop: {
               ...lastStop,
               matchedShapeSequence: lastStopShape
                  ? lastStopShape.shape_pt_sequence
                  : "No match",
            },
            nextStop: {
               ...nextStop,
               matchedShapeSequence: nextStopShape
                  ? nextStopShape.shape_pt_sequence
                  : "No match",
            },
         };
      });

      // Step 5: per ciascun trip prendi la fetta di shape che deve fare compresa tra la sua ultima fermata fatta e l'ultima fermata del viaggio
      const shapesByTripId = {};
      stopsWithShapeInfo.forEach((stop) => {
         const lastStopSeq = stop.lastStop.matchedShapeSequence;
         const nextStopSeq = stop.nextStop.matchedShapeSequence;
         const tripId = stop.lastStop.trip_id;

         if (lastStopSeq !== "No Match" && nextStopSeq !== "No match") {
            const lastSeq = parseInt(lastStopSeq);
            const nextSeq = parseInt(nextStopSeq);

            const tripShapesInRange = shapeId.filter((shape) => {
               const sequence = parseInt(shape.shape_pt_sequence, 10);
               return (
                  sequence >= lastSeq &&
                  sequence <= nextSeq &&
                  shape.shape_id === shapeAttive[0]
               );
            });

            if (!shapesByTripId[tripId]) {
               shapesByTripId[tripId] = [];
            }

            shapesByTripId[tripId].push(...tripShapesInRange);
         }
      });

      return {
         stopsWithShapeInfo,
         shapesByTripId,
      };
   };

   useEffect(() => {
      const updateMarker = () => {
         const currentMap = mapViewRef.current?.map;
         const stopsLayer = currentMap?.findLayerById("stopsFeatureLayer");
         const lineeLayer = currentMap?.findLayerById("linesFeatureLayer");
         const mapView = mapViewRef.current;
         const animationLayer = animationGraphicsLayer;

         // filtro shapesData e prendo solo l'id delle shape attive al momento
         const activeShape = shapesData.filter((shape) =>
             activeShapes.includes(shape.shape_id)
         );

         if (stopsLayer) {
            if (allStops) {
               stopsLayer.definitionExpression = null;
               stopsLayer.visible = true;
            } else if (selectedLongNames.size > 0) {
               const selectedRouteTrips = validTrips[selectedRouteShortName] || []; // selezioniamo solo quelle che ci interessano dato il numero del vaporetto
               const tripStopIds = new Set();

               Array.from(selectedLongNames).forEach((longName) => {
                  const matchingTrips = selectedRouteTrips.filter(
                     (trip) => trip.route_long_name === longName
                  );

                  if (matchingTrips) {
                     const tripIds = matchingTrips.map((trip) => trip.trip_id);
                     const stopIds = getStopIdsByTripId(
                         tripIds[0],
                        stopTimesData
                     );
                     stopIds.forEach((id) => tripStopIds.add(id));

                     // NOTA: gli orari notturni sono segnati come 25:00, 26:00..., per ottenere risulati validi sottraiamo 24
                     const timeToMinutes = (time) => {
                        let [hours, minutes] = time.split(":").map(Number);
                        if (hours >= 24) {
                           hours -= 24;
                        }
                        return hours * 60 + minutes;
                     };

                     const filteredTrips = stopTimesData.filter(
                        (row) =>
                            tripIds.includes(row.trip_id) &&
                           timeToMinutes(row.arrival_time) <=
                              timeToMinutes(currentTime)
                     );

                     const latestStopPerTrip = {};

                     filteredTrips.sort(
                        (a, b) =>
                           timeToDate(b.arrival_time) -
                           timeToDate(a.arrival_time)
                     );

                     // determiniamo l'ultima fermata fatta per ciascun trip
                     filteredTrips.forEach((row) => {
                        const { trip_id, stop_id, arrival_time } = row;
                        const arrivalDate = timeToDate(arrival_time);

                        if (
                           !latestStopPerTrip[trip_id] ||
                           arrivalDate > latestStopPerTrip[trip_id].arrival_time
                        ) {
                           latestStopPerTrip[trip_id] = {
                              stop_id,
                              arrival_time: arrivalDate,
                           };
                        }
                     });

                     // stopsWithShapeInfo: contiene solo i trip validi per giorno, per ora, per numero di battello scelto e per route_long_name
                     // shapesByTripId: mi inidica quale shape ciascun trip deve seguire
                     const { stopsWithShapeInfo, shapesByTripId } = processStopsAndShapes(
                         tripsToConsider,
                         stopTimesData,
                         stopsData,
                         shapesData,
                         activeShapes,
                         currentTime
                     );

                     const parseTimeToDate = (timeStr) => {
                        const [hours, minutes, seconds] = timeStr
                           .split(":")
                           .map(Number);
                        const date = new Date();
                        date.setHours(hours, minutes, seconds, 0);
                        return date;
                     };

                     // funzioni per calcolare quanto tempo ci mette il marker a muoversi
                     const calculateTimeWindow = (
                        departureTime,
                        arrivalTime
                     ) => {
                        const departureDate = parseTimeToDate(departureTime);
                        const arrivalDate = parseTimeToDate(arrivalTime);
                        return (arrivalDate - departureDate) / 1000;
                     };

                     const calculateElapsedSeconds = (departureTime) => {
                        const departureDate = parseTimeToDate(departureTime);
                        const elapsedMilliseconds = Date.now() - departureDate;
                        const elapsedSeconds = elapsedMilliseconds / 1000;

                        // Assicuriamoci che il tempo trascorso non sia negativo
                        return Math.max(elapsedSeconds, 0);
                        // return (Date.now() - departureDate) / 1000;
                     };

                     const calculateSpeedScale = (
                        departureTime,
                        arrivalTime,
                        delaySeconds
                     ) => {
                        const totalJourneyDuration = calculateTimeWindow(
                           departureTime,
                           arrivalTime
                        );
                        const newTotalDuration =
                           totalJourneyDuration + delaySeconds;
                        return totalJourneyDuration / newTotalDuration;
                     };

                     const getCurrentMarkerPosition = (path, progress) => {
                        if (!path || path.length === 0) return null;

                        const totalSteps = path.length;
                        const index = Math.floor(progress * totalSteps);
                        return path[Math.min(index, totalSteps - 1)];
                     };

                     if (mapViewRef.current) {
                        const graphicsLayer = new GraphicsLayer();
                        mapViewRef.current.map.add(graphicsLayer);

                        const symbol = new PictureMarkerSymbol({
                           url: "/battello.png",
                           width: "24px",
                           height: "24px",
                        });

                        if (!userLocation) {
                           animationGraphicsLayer.removeAll();
                           mapView.graphics.removeAll();

                           // funzione per cominciare l'animazione
                           const startAnimation = (
                              tripId,
                              path,
                              departureTime,
                              arrivalTime
                           ) => {
                              // consideriamo un ritardo di 2 minuti per tutti i viaggi
                              const DELAY_SECONDS = 120; // 2 mins in secs
                              const ANIMATION_SPEED_SCALE = calculateSpeedScale(
                                 departureTime,
                                 arrivalTime,
                                 DELAY_SECONDS
                              );

                              const timeWindow = calculateTimeWindow(
                                 departureTime,
                                 arrivalTime
                              );

                              const elapsedSeconds =
                                  calculateElapsedSeconds(departureTime);

                              const calculateAnimationProgress = (
                                 elapsedTime,
                                 duration
                              ) => {
                                 const adjustedElapsedTime =
                                    elapsedTime * ANIMATION_SPEED_SCALE;
                                 return Math.min(
                                    adjustedElapsedTime / duration,
                                    1
                                 );
                              };

                              const progress = calculateAnimationProgress(
                                  elapsedSeconds,
                                 timeWindow
                              );

                              const currentPathPosition = getCurrentMarkerPosition(
                                 path,
                                 progress
                              );

                              if (!currentPathPosition) return;

                              const marker = new Graphic({
                                 geometry: new Point({
                                    x: currentPathPosition.shape_pt_lon,
                                    y: currentPathPosition.shape_pt_lat,
                                    spatialReference: { wkid: 4326 },
                                 }),
                                 symbol,
                              });

                              animationLayer.add(marker);

                              let animationStart = Date.now();
                              const duration = timeWindow - elapsedSeconds;

                              const updatePosition = () => {
                                 const elapsedTime =
                                    (Date.now() - animationStart) / 1000;
                                 const progress = calculateAnimationProgress(
                                    elapsedTime,
                                    duration
                                 );
                                 const newMarkerPosition =
                                    getCurrentMarkerPosition(path, progress);

                                 if (newMarkerPosition) {
                                    marker.geometry = new Point({
                                       x: newMarkerPosition.shape_pt_lon,
                                       y: newMarkerPosition.shape_pt_lat,
                                       spatialReference: { wkid: 4326 },
                                    });
                                 }

                                 // arrivato a destinazione eliminiamo il marker
                                 if (progress >= 1) {
                                    marker.geometry = new Point({
                                       x: path[path.length - 1].shape_pt_lon,
                                       y: path[path.length - 1].shape_pt_lat,
                                       spatialReference: { wkid: 4326 },
                                    });

                                    animationGraphicsLayer.remove(marker);

                                    return;
                                 }

                                 requestAnimationFrame(updatePosition);
                              };

                              updatePosition();
                           };

                           // serve per mettere il marker A e B di inizio e fine corsa
                           if (activeShape.length > 0) {
                              const firstPoint = activeShape[0];
                              const lastPoint = activeShape[activeShape.length - 1];

                              const startPoint = new Point({
                                 x: parseFloat(firstPoint.shape_pt_lon),
                                 y: parseFloat(firstPoint.shape_pt_lat),
                                 spatialReference: { wkid: 4326 },
                              });

                              const endPoint = new Point({
                                 x: parseFloat(lastPoint.shape_pt_lon),
                                 y: parseFloat(lastPoint.shape_pt_lat),
                                 spatialReference: { wkid: 4326 },
                              });

                              const startSymbol = new PictureMarkerSymbol({
                                 url: "/beginning.png",
                                 width: "36px",
                                 height: "36px",
                              });

                              const endSymbol = new PictureMarkerSymbol({
                                 url: "/destination.png",
                                 width: "36px",
                                 height: "36px",
                              });

                              const startMarkerGraphic = new Graphic({
                                 geometry: startPoint,
                                 symbol: startSymbol,
                              });

                              const endMarkerGraphic = new Graphic({
                                 geometry: endPoint,
                                 symbol: endSymbol,
                              });

                              animationLayer.add(startMarkerGraphic);
                              animationLayer.add(endMarkerGraphic);
                           }

                           Object.entries(shapesByTripId).forEach(
                              ([tripId, path]) => {
                                 const tripStops = stopsWithShapeInfo.find(
                                    (stop) => stop.tripId === tripId
                                 );
                                 if (tripStops && path) {
                                    const { lastStop, nextStop } = tripStops;
                                    const departureTime = lastStop.arrival_time;
                                    const arrivalTime = nextStop.arrival_time;

                                    startAnimation(
                                       tripId,
                                       path,
                                       departureTime,
                                       arrivalTime
                                    );
                                 }
                              }
                           );
                        } else if (userLocation && stopsWithShapeInfo.length > 0) {
                           // uguale a prima, ma con la location dell'utente attivata
                           // in questo caso mostriamo solo il viaggio con l'ultima fermata fatta più vicina all'utente (distanza euclidea)
                           const graphic = animationGraphicsLayer;
                           graphic.removeAll();
                           mapView.graphics.removeAll();
                           const closestLastStop = stopsWithShapeInfo.reduce(
                              (closest, trip) => {
                                 if (
                                    trip.lastStop &&
                                    trip.lastStop.stop_lat &&
                                    trip.lastStop.stop_lon
                                 ) {
                                    const stopLat = parseFloat(
                                       trip.lastStop.stop_lat
                                    );
                                    const stopLon = parseFloat(
                                       trip.lastStop.stop_lon
                                    );

                                    const distance = Math.sqrt(
                                       Math.pow(
                                          userLocation.latitude - stopLat,
                                          2
                                       ) +
                                          Math.pow(
                                             userLocation.longitude - stopLon,
                                             2
                                          )
                                    );

                                    return distance < closest.distance
                                       ? {
                                            stop: trip.lastStop,
                                            tripId: trip.tripId,
                                            distance,
                                         }
                                       : closest;
                                 }
                                 return closest;
                              },
                              { stop: null, distance: Infinity }
                           );

                           const specificShape =
                              shapesByTripId[closestLastStop.stop.trip_id];

                           const startAnimation = (
                              path,
                              departureTime,
                              arrivalTime
                           ) => {
                              if (!path || path.length === 0) return;

                              const symbol = new PictureMarkerSymbol({
                                 url: "/battello.png",
                                 width: "24px",
                                 height: "24px",
                              });

                              const parseTimeToDate = (timeStr) => {
                                 const [hours, minutes, seconds] = timeStr
                                    .split(":")
                                    .map(Number);
                                 const date = new Date();
                                 date.setHours(hours, minutes, seconds, 0);
                                 return date;
                              };

                              const calculateTimeWindow = (
                                 departureTime,
                                 arrivalTime
                              ) => {
                                 const departureDate =
                                    parseTimeToDate(departureTime);
                                 const arrivalDate =
                                    parseTimeToDate(arrivalTime);
                                 return (arrivalDate - departureDate) / 1000;
                              };

                              const calculateElapsedTime = (departureTime) => {
                                 const departureDate =
                                    parseTimeToDate(departureTime);
                                 return (Date.now() - departureDate) / 1000;
                              };

                              const calculateProgress = (
                                 elapsedTime,
                                 duration
                              ) => {
                                 return Math.min(elapsedTime / duration, 1);
                              };

                              const getCurrentMarkerPosition = (
                                 path,
                                 progress
                              ) => {
                                 if (!path || path.length === 0) return null;

                                 const totalSteps = path.length;
                                 const index = Math.floor(
                                    progress * totalSteps
                                 );
                                 return path[Math.min(index, totalSteps - 1)];
                              };

                              const timeWindow = calculateTimeWindow(
                                 departureTime,
                                 arrivalTime
                              );
                              const elapsedTime =
                                 calculateElapsedTime(departureTime);
                              const progress = calculateProgress(
                                 elapsedTime,
                                 timeWindow
                              );
                              const markerPosition = getCurrentMarkerPosition(
                                 path,
                                 progress
                              );

                              if (!markerPosition) return;

                              const marker = new Graphic({
                                 geometry: new Point({
                                    x: markerPosition.shape_pt_lon,
                                    y: markerPosition.shape_pt_lat,
                                    spatialReference: { wkid: 4326 },
                                 }),
                                 symbol,
                              });

                              animationLayer.add(marker);

                              // impostiamo i marker di inizio e fine corsa
                              if (activeShape.length > 0) {
                                 const firstPoint = activeShape[0];
                                 const lastPoint = activeShape[activeShape.length - 1];

                                 // Create Point objects
                                 const startPoint = new Point({
                                    x: parseFloat(firstPoint.shape_pt_lon),
                                    y: parseFloat(firstPoint.shape_pt_lat),
                                    spatialReference: { wkid: 4326 },
                                 });

                                 const endPoint = new Point({
                                    x: parseFloat(lastPoint.shape_pt_lon),
                                    y: parseFloat(lastPoint.shape_pt_lat),
                                    spatialReference: { wkid: 4326 },
                                 });

                                 const beginSymbol = new PictureMarkerSymbol({
                                    url: "/beginning.png",
                                    width: "36px",
                                    height: "36px",
                                 });

                                 const destSymbol = new PictureMarkerSymbol({
                                    url: "/destination.png",
                                    width: "36px",
                                    height: "36xpx",
                                 });

                                 const startGraphic = new Graphic({
                                    geometry: startPoint,
                                    symbol: beginSymbol,
                                 });

                                 const endGraphic = new Graphic({
                                    geometry: endPoint,
                                    symbol: destSymbol,
                                 });

                                 animationLayer.add(startGraphic);
                                 animationLayer.add(endGraphic);
                              }

                              let animationStart = Date.now();
                              const duration = timeWindow - elapsedTime;

                              const updatePosition = () => {
                                 const elapsedTime =
                                    (Date.now() - animationStart) / 1000;
                                 const progress = calculateProgress(
                                    elapsedTime,
                                    duration
                                 );
                                 const newMarkerPosition =
                                    getCurrentMarkerPosition(path, progress);

                                 if (newMarkerPosition) {
                                    marker.geometry = new Point({
                                       x: newMarkerPosition.shape_pt_lon,
                                       y: newMarkerPosition.shape_pt_lat,
                                       spatialReference: { wkid: 4326 },
                                    });
                                 }

                                 if (progress >= 1) {
                                    marker.geometry = new Point({
                                       x: path[path.length - 1].shape_pt_lon,
                                       y: path[path.length - 1].shape_pt_lat,
                                       spatialReference: { wkid: 4326 },
                                    });

                                    graphicsLayer.remove(marker);

                                    return;
                                 }

                                 requestAnimationFrame(updatePosition);
                              };

                              updatePosition();
                           };

                           const tripStops = stopsWithShapeInfo.find(
                              (trip) =>
                                 trip.tripId === closestLastStop.stop.trip_id
                           );
                           if (tripStops && specificShape) {
                              const { lastStop, nextStop } = tripStops;
                              const departureTime = lastStop.arrival_time;
                              const arrivalTime = nextStop.arrival_time;

                              startAnimation(
                                 specificShape,
                                 departureTime,
                                 arrivalTime
                              );
                           }
                           if (!closestLastStop.stop) {
                              console.log("Nessuna ultima fermata trovata");
                           }
                        }
                     } else {
                        console.log("Stop_id non esistente");
                     }
                  }
               });

               const whereClause = `stop_id IN (${Array.from(tripStopIds)
                  .map((id) => `'${id}'`)
                  .join(",")})`;

               if (whereClause.trim()) {
                  stopsLayer.definitionExpression = whereClause;
                  stopsLayer.visible = true;
               } else {
                  stopsLayer.definitionExpression = "1=0";
                  stopsLayer.visible = false;
               }
            } else {
               stopsLayer.definitionExpression = "1=0";
               stopsLayer.visible = false;
            }
         }

         if (lineeLayer) {
            if (selectedRouteShortName) {
               const filteredTrips = enrichedTrip[selectedRouteShortName] || [];
               const shapeIds = filteredTrips
                  .filter((trip) => selectedLongNames.has(trip.route_long_name))
                  .map((trip) => trip.shape_id)
                  .filter((shapeId) => shapeId !== null);

               if (shapeIds.length > 0) {
                  const shapeIdExpression = shapeIds
                     .map((id) => `shape_id = '${id}'`)
                     .join(" OR ");
                  lineeLayer.definitionExpression = shapeIdExpression;
                  lineeLayer.visible = true;
               } else {
                  lineeLayer.definitionExpression = "1=0";
                  lineeLayer.visible = false;
               }
            } else {
               lineeLayer.definitionExpression = "1=0";
               lineeLayer.visible = false;
            }
         }
      };

      updateMarker();
   }, [
      allStops,
      selectedLongNames,
      enrichedTrip,
      selectedRouteShortName,
      stopTimesData,
      stopsData,
      validTrips,
      userLocation,
      activeShapes,
      shapesData,
      currentTime,
      tripsToConsider,
      animationGraphicsLayer,
   ]);

   const handleAllStops = () => {
      setAllStops((prev) => !prev);
   };

   // handler per quando si preme il numero della linea
   const handleButtonClick = (numeroBattello) => {
      const map = mapViewRef.current?.map;
      const view = mapViewRef.current;

      if (view) {
         view.graphics.removeAll();
         const stopsLayer = map?.findLayerById("stopsFeatureLayer");
         if (stopsLayer) {
            stopsLayer.definitionExpression = "1=0";
            stopsLayer.visible = false;
         }

         const lineeLayer = map?.findLayerById("linesFeatureLayer");
         if (lineeLayer) {
            lineeLayer.definitionExpression = "1=0";
            lineeLayer.visible = false;
         }

         if (animationGraphicsLayer) {
            animationGraphicsLayer.removeAll();
         }
      }

      if (selectedRouteShortName === numeroBattello) {
         setSelectedRouteShortName(null);
         setLongNameOptions([]);
         setSelectedLongNames(new Set());
      } else {
         setSelectedRouteShortName(numeroBattello);
         setLongNameOptions(
            enrichedTrip[numeroBattello].map((route) => route.route_long_name)
         );
         setSelectedLongNames(new Set());
      }
   };

   // handler per quando si preme la corsa selezionata
   const handleLongNameClick = (longName) => {
      const mapView = mapViewRef.current?.map;
      const currentView = mapViewRef.current;

      if (currentView) {
         currentView.graphics.removeAll();

         const stopsLayer = mapView?.findLayerById("stopsFeatureLayer");
         if (stopsLayer) {
            stopsLayer.definitionExpression = "1=0";
            stopsLayer.visible = false;
         }

         const linesLayer = mapView?.findLayerById("linesFeatureLayer");
         if (linesLayer) {
            linesLayer.definitionExpression = "1=0";
            linesLayer.visible = false;
         }

         if (animationGraphicsLayer) {
            animationGraphicsLayer.removeAll();
         }
      }

      const updatedLongNames = new Set(selectedLongNames);
      if (updatedLongNames.has(longName)) {
         updatedLongNames.delete(longName);
      } else {
         updatedLongNames.clear();
         updatedLongNames.add(longName);
      }

      setSelectedLongNames(updatedLongNames);

      const filteredTrips = validTrips[selectedRouteShortName] || [];
      const shapeIds = filteredTrips
         .filter((trip) => updatedLongNames.has(trip.route_long_name))
         .map((trip) => trip.shape_id)
         .filter((shapeId) => shapeId !== null);

      const tripsWithLongName = filteredTrips.filter(
         (trip) => trip.route_long_name === longName
      );
      setTripsToConsider(tripsWithLongName);

      setActiveShapes(shapeIds);

      centerMapOnShapes(shapeIds);
   };

   const [earliestTripDetails, setEarliestTripDetails] = useState(null);

   // handler per quando si preme il bottone invio
   const handleSubmit = () => {
      if (!startPoint || !endPoint || startPoint === endPoint) {
         alert("Seleziona due punti diversi e validi");
         return;
      }
      const view = mapViewRef.current;

      if (view) {
         view.graphics.removeAll();

         const stopsLayer = view.map.findLayerById("stopsFeatureLayer");
         if (stopsLayer) {
            stopsLayer.visible = false;
         }

         const linesLayer = view.map.findLayerById("linesFeatureLayer");
         if (linesLayer) {
            linesLayer.visible = false;
         }

         if (animationGraphicsLayer) {
            animationGraphicsLayer.removeAll();
         }
      }

      const groupStopTimesByValidTrips = (validTripsId, stopTimesData) => {
         if (!Array.isArray(validTripsId)) {
            console.error("validTripsId non è un array o non è definito");
            return {};
         }

         const filteredData = stopTimesData.filter((row) =>
            validTripsId.includes(row.trip_id)
         );

         const groupedData = filteredData.reduce((acc, row) => {
            if (!acc[row.trip_id]) {
               acc[row.trip_id] = [];
            }
            acc[row.trip_id].push(row);
            return acc;
         }, {});

         return groupedData;
      };

      const groupedStopTimes = groupStopTimesByValidTrips(
         validTripsId,
         stopTimesData
      );

      const findTripWithEarliestDeparture = (
         groupedStopTimes,
         startPoint,
         endPoint
      ) => {
         const tripsWithBothStops = Object.values(groupedStopTimes).filter(
            (tripStops) => {
               const stopIds = new Set(tripStops.map((stop) => stop.stop_id));
               return stopIds.has(startPoint) && stopIds.has(endPoint);
            }
         );

         let earliestTrip = null;
         let earliestDepartureTime = null;

         for (const tripStops of tripsWithBothStops) {
            const startStop = tripStops.find(
               (stop) => stop.stop_id === startPoint
            );
            const endStop = tripStops.find((stop) => stop.stop_id === endPoint);

            if (
               startStop &&
               endStop &&
               startStop.stop_sequence < endStop.stop_sequence
            ) {
               const departureTime = startStop.departure_time;

               if (
                  !earliestDepartureTime ||
                  departureTime < earliestDepartureTime
               ) {
                  earliestDepartureTime = departureTime;
                  earliestTrip = tripStops;
               }
            }
         }

         return earliestTrip;
      };

      const earliestTrip = findTripWithEarliestDeparture(
         groupedStopTimes,
         startPoint,
         endPoint
      );

      if (!earliestTrip) {
         setNoLinesFound(true);
         setEarliestTripDetails(null);
         return;
      }

      const earliestRoute = tripsData.find(
         (trip) => trip.trip_id === earliestTrip[0].trip_id
      );

      const earliestNumber = routesData.find(
         (route) => route.route_id === earliestRoute.route_id
      );

      const tripDetails = {
         routeShortName: earliestNumber.route_short_name,
         routeLongName: earliestNumber.route_long_name,
      };

      setEarliestTripDetails(tripDetails);
      setNoLinesFound(false);

      // Simula il click del bottone
      handleButtonClick(tripDetails.routeShortName);
   };

   // shadow-sm

   const routeColors = {
      1: { background: "#FFFFFF", text: "#000000" },
      11: { background: "#F7ACBC", text: "#000000" },
      13: { background: "#57419A", text: "#FFFFFF" },
      15: { background: "#DD7127", text: "#D9D535" },
      16: { background: "#FBAA2B", text: "#000000" },
      17: { background: "#82868C", text: "#FFFFFF" },
      18: { background: "#FFD52B", text: "#000000" },
      20: { background: "#C7AAD1", text: "#000000" },
      4.1: { background: "#B43B96", text: "#FFFFFF" },
      4.2: { background: "#B43B96", text: "#FFFFFF" },
      7: { background: "#9366", text: "#FFFFFF" },
      5.1: { background: "#8FD2BF", text: "#000000" },
      5.2: { background: "#8FD2BF", text: "#000000" },
      6: { background: "#006BB7", text: "#FFFFFF" },
      N: { background: "#25408D", text: "#FFFFFF" },
      NLN: { background: "#25408D", text: "#FFFFFF" },
      NMU: { background: "#25408D", text: "#FFFFFF" },
      9: { background: "#948F03", text: "#FFFFFF" },
      22: { background: "#C4C130", text: "#00646A" },
      14: { background: "#F37736", text: "#000000" },
      2: { background: "#FF0000", text: "#FFFFFF" },
      8: { background: "#82683B", text: "#FFFFFF" },
      10: { background: "#4DC8E9", text: "#000000" },
      12: { background: "#DAD635", text: "#000000" },
      "2/": { background: "#FF0000", text: "#FFFFFF" },
      NM: { background: "#FFFFFF", text: "#000000" },
   };

   const buttonColors = {
      mostraTutteFermate: { background: "#007bff", text: "#ffffff" }, // Blue button
      mostraPosizione: { background: "#28a745", text: "#ffffff" }, // Green button
      nascondiPosizione: { background: "#ffc107", text: "#000000" }, // Yellow button
      impostaPosizione: { background: "#17a2b8", text: "#ffffff" }, // Teal button
      rimuoviPosizione: { background: "#dc3545", text: "#ffffff" }, // Red button
   };

   return (
      <div className="map-page">
         <div className="header-container">
            <div className="mt-4 mb-2 p-3 rounded custom-container">
               <div className="image-container">
                  <a href="https://serendpt.net">
                     <img
                        src="/SerenDPTLOGO Black.png"
                        alt="SerenDPT"
                        width="80"
                        height="80"
                     />
                  </a>
                  <a href="https://veniceprojectcenter.org">
                     <img
                        src="VPCsquare.png"
                        alt="Venice Project Center"
                        width="80"
                        height="80"
                     />
                  </a>
               </div>
               <div className="row align-items-center justify-content-center no-gutters controlbox">
                  <div className="col-4 col-md-2 d-flex flex-column align-items-center px-1">
                     <select
                        className="form-control rounded custom-input"
                        value={startPoint || ""}
                        onChange={(e) => setStartPoint(e.target.value)}
                     >
                        <option value="">Partenza</option>
                        {stopsData
                           .filter(
                              (stop) => stop.stop_id !== parseInt(endPoint)
                           )
                           .map((stop) => (
                              <option key={stop.stop_id} value={stop.stop_id}>
                                 {stop.stop_name}
                              </option>
                           ))}
                     </select>
                  </div>
                  <div className="col-4 col-md-2 d-flex flex-column align-items-center px-1">
                     <select
                        className="form-control rounded custom-input"
                        value={endPoint || ""}
                        onChange={(e) => setEndPoint(e.target.value)}
                     >
                        <option value="">Arrivo</option>
                        {stopsData
                           .filter(
                              (stop) => stop.stop_id !== parseInt(startPoint)
                           )
                           .map((stop) => (
                              <option key={stop.stop_id} value={stop.stop_id}>
                                 {stop.stop_name}
                              </option>
                           ))}
                     </select>
                  </div>
                  <div className="col-4 col-md-2 d-flex flex-column align-items-center px-1">
                     <input
                        type="time"
                        className="form-control rounded custom-input"
                        value={currentTime}
                        onChange={handleTimeChange}
                        step="0"
                     />
                  </div>
               </div>
               <div className="row mt-3 justify-content-center no-gutters">
                  <div className="col-4 col-md-2 d-flex justify-content-center px-1">
                     <button
                        className="btn btn-primary rounded-pill px-4 search-button"
                        onClick={handleSubmit}
                     >
                        Cerca il vaporetto
                     </button>
                  </div>
               </div>
               {earliestTripDetails && (
                  <div className="row mt-4 justify-content-center">
                     <div className="col-md-6 d-flex justify-content-center">
                        <p className="blackthingontheright">
                           Linea {earliestTripDetails.routeShortName},{" "}
                           {earliestTripDetails.routeLongName}
                        </p>
                     </div>
                  </div>
               )}
               {noLinesFound && (
                  <div className="row mt-4 justify-content-center">
                     <div className="col-md-6 d-flex justify-content-center">
                        <p className="blackthingontheright">
                           Nessuna linea trovata
                        </p>
                     </div>
                  </div>
               )}
            </div>
         </div>

         <div className="map-page-content">
            <div className="sidebar">
               <div className="container mt-4">
                  <button
                     className="btn btn-primary m-2 w-100"
                     onClick={handleAllStops}
                     style={{
                        backgroundColor:
                           buttonColors.mostraTutteFermate.background,
                        color: buttonColors.mostraTutteFermate.text,
                        border: "1px solid #000000",
                     }}
                  >
                     Mostra tutte le fermate
                  </button>
                  <br />
                  <button
                     className="btn btn-primary m-2 w-100"
                     onClick={toggleUserLocation}
                     style={{
                        backgroundColor: isLocationVisible
                           ? buttonColors.nascondiPosizione.background
                           : buttonColors.mostraPosizione.background,
                        color: isLocationVisible
                           ? buttonColors.nascondiPosizione.text
                           : buttonColors.mostraPosizione.text,
                        border: "1px solid #000000",
                     }}
                  >
                     {isLocationVisible
                        ? "Nascondi Posizione"
                        : "Mostra Posizione"}
                  </button>
                  <button
                     className="btn btn-secondary m-2 w-100"
                     onClick={enableMapClick}
                     style={{
                        backgroundColor:
                           buttonColors.impostaPosizione.background,
                        color: buttonColors.impostaPosizione.text,
                        border: "1px solid #000000",
                     }}
                  >
                     Imposta Posizione
                  </button>
                  <button
                     className="btn btn-danger m-2 w-100"
                     onClick={clearUserLocationLayer}
                     style={{
                        backgroundColor:
                           buttonColors.rimuoviPosizione.background,
                        color: buttonColors.rimuoviPosizione.text,
                        border: "1px solid #000000",
                     }}
                  >
                     Rimuovi Posizione
                  </button>

                  <h2>Linee attive</h2>
                  {Object.keys(enrichedTrip).map((numeroBattello) => {
                     const { background, text } = routeColors[
                        numeroBattello
                     ] || { background: "#000000", text: "#FFFFFF" };
                     return (
                        <div key={numeroBattello} className="mb-3">
                           <Button
                              variant="primary"
                              className="w-100"
                              onClick={() => handleButtonClick(numeroBattello)}
                              aria-controls={`collapse-${numeroBattello}`}
                              aria-expanded={
                                 selectedRouteShortName === numeroBattello
                              }
                              style={{
                                 backgroundColor: background,
                                 color: text,
                                 border: "1px solid #000000",
                              }}
                           >
                              Linea {numeroBattello}
                           </Button>
                           <Collapse
                              in={selectedRouteShortName === numeroBattello}
                           >
                              <div id={`collapse-${numeroBattello}`}>
                                 <Card className="mt-2">
                                    <Card.Body>
                                       <ListGroup>
                                          {longNameOptions.map(
                                             (longName, index) => (
                                                <ListGroup.Item
                                                   key={index}
                                                   action
                                                   onClick={() =>
                                                      handleLongNameClick(
                                                         longName
                                                      )
                                                   }
                                                   className={
                                                      selectedLongNames.has(
                                                         longName
                                                      )
                                                         ? "selected-item"
                                                         : ""
                                                   }
                                                >
                                                   {longName}
                                                </ListGroup.Item>
                                             )
                                          )}
                                       </ListGroup>
                                    </Card.Body>
                                 </Card>
                              </div>
                           </Collapse>
                        </div>
                     );
                  })}
               </div>
            </div>

            <div className="map-container">
               <div ref={mapRef} className="map" />
            </div>
         </div>

         <div className="footer">
            <p>
               {" "}
               Created by{" "}
               <a
                  href="https://www.linkedin.com/in/gabriele-armani-052422235?lipi=urn%3Ali%3Apage%3Ad_flagship3_profile_view_base_contact_details%3BsQW%2FPtG2RJeD9Oz3sYg1uA%3D%3D"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="footer-link"
               >
                  {" "}
                  Gabriele Armani{" "}
               </a>{" "}
               under SerenDPT{" "}
            </p>
         </div>
      </div>
   );
}

export default MapComponent;
