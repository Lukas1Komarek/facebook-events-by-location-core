"use strict";

var Promise = require("bluebird");
var rp = require("request-promise");
var path = require("path");
var fs = require("fs");

var schema = JSON.parse(fs.readFileSync(path.join(__dirname, "../", "schema", "events-response.schema.json"), "utf8"));

var fields = [
  "id",
  "checkins",
  "engagement",
  "name",
  // "cover.fields(id,source)",
  // "picture.type(large)",
  "location",
  "description",
  // Pub, Dance & Night Club, Performance & Event Venue, Bar
  "category_list",
  "is_permanently_closeds",
  "cover"
  // "events.fields(" + eventsFields.join(",") + ")"
];

var LocationSearch = function (options) {

  var self = this,
    allowedSorts = ["time", "distance", "venue", "popularity"];

  self.latitude = options.lat || null;
  self.longitude = options.lng || null;
  self.distance = options.distance || 100;
  self.accessToken = options.accessToken ? options.accessToken : (process.env.FEBL_ACCESS_TOKEN && process.env.FEBL_ACCESS_TOKEN !== "" ? process.env.FEBL_ACCESS_TOKEN : null);
  self.query = options.query ? encodeURIComponent(options.query) : "";
  self.sort = options.sort ? (allowedSorts.indexOf(options.sort.toLowerCase()) > -1 ? options.sort.toLowerCase() : null) : null;
  self.version = options.version ? options.version : "v2.7";
  self.since = options.since || (new Date().getTime() / 1000).toFixed();
  self.until = options.until || null;
  self.schema = schema;
  // placeId -> {events, timestamp}
  self.cache = {};

};

LocationSearch.prototype.calculateStarttimeDifference = function (currentTime, dataString) {
  return (new Date(dataString).getTime() - (currentTime * 1000)) / 1000;
};

LocationSearch.prototype.compareVenue = function (a, b) {
  if (a.venue.name < b.venue.name)
    return -1;
  if (a.venue.name > b.venue.name)
    return 1;
  return 0;
};

LocationSearch.prototype.compareTimeFromNow = function (a, b) {
  if (a.timeFromNow < b.timeFromNow)
    return -1;
  if (a.timeFromNow > b.timeFromNow)
    return 1;
  return 0;
};

LocationSearch.prototype.compareDistance = function (a, b) {
  var aEventDistInt = parseInt(a.distance, 10);
  var bEventDistInt = parseInt(b.distance, 10);
  if (aEventDistInt < bEventDistInt)
    return -1;
  if (aEventDistInt > bEventDistInt)
    return 1;
  return 0;
};

LocationSearch.prototype.comparePopularity = function (a, b) {
  if ((a.stats.attending + (a.stats.maybe / 2)) < (b.stats.attending + (b.stats.maybe / 2)))
    return 1;
  if ((a.stats.attending + (a.stats.maybe / 2)) > (b.stats.attending + (b.stats.maybe / 2)))
    return -1;
  return 0;
};


LocationSearch.prototype.fillEventObject = function (event, venueId, venue, eventResultObj, categoryList) {
  eventResultObj.id = event.id;
  eventResultObj.name = event.name;
  eventResultObj.type = event.type;
  eventResultObj.coverPicture = (event.cover ? event.cover.source : null);
  eventResultObj.profilePicture = (event.picture ? event.picture.data.url : null);
  eventResultObj.description = (event.description ? event.description : null);
  eventResultObj.distance = (venue.location ? (self.haversineDistance([venue.location.latitude, venue.location.longitude], [self.latitude, self.longitude], false) * 1000).toFixed() : null);
  eventResultObj.startTime = (event.start_time ? event.start_time : null);
  eventResultObj.endTime = (event.end_time ? event.end_time : null);
  eventResultObj.timeFromNow = self.calculateStarttimeDifference(currentTimestamp, event.start_time);
  eventResultObj.category = (event.category ? event.category : null);
  eventResultObj.stats = {
    attending: event.attending_count,
    declined: event.declined_count,
    maybe: event.maybe_count,
    noreply: event.noreply_count
  };
  eventResultObj.venue = {};
  eventResultObj.venue.id = venueId;
  eventResultObj.venue.name = venue.name;
  eventResultObj.venue.about = (venue.about ? venue.about : null);
  eventResultObj.venue.emails = (venue.emails ? venue.emails : null);
  eventResultObj.venue.coverPicture = (venue.cover ? venue.cover.source : null);
  eventResultObj.venue.profilePicture = (venue.picture ? venue.picture.data.url : null);
  eventResultObj.venue.category = (venue.category ? venue.category : null);
  eventResultObj.venue.categoryList = categoryList;
  eventResultObj.venue.location = (venue.location ? venue.location : null);
  return eventResultObj;
}

LocationSearch.prototype.haversineDistance = function (coords1, coords2, isMiles) {

  //coordinate is [latitude, longitude]
  function toRad(x) {
    return x * Math.PI / 180;
  }

  var lon1 = coords1[1];
  var lat1 = coords1[0];

  var lon2 = coords2[1];
  var lat2 = coords2[0];

  var R = 6371; // km

  var x1 = lat2 - lat1;
  var dLat = toRad(x1);
  var x2 = lon2 - lon1;
  var dLon = toRad(x2);
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  var d = R * c;

  if (isMiles) d /= 1.60934;

  return d;

};

LocationSearch.prototype.search = function () {

  var self = this;

  function getPlaces(url) {
    var results;
    var temp;

    function getPlacesPaging(first, url, after) {
      var tempurl;
      if (after !== "") {
        tempurl = url + "&after=" + after;
      } else {
        tempurl = url;
      }
      return rp.get(tempurl).then(function success(responseBody) {
        temp = JSON.parse(responseBody);
        if (first) {
          results = temp;
        } else {
          temp.data.forEach(function (item, index, arr) {
            results.data.push(item);
          })
        }
        if (temp.paging && temp.paging.cursors && temp.paging.cursors.after) {
          return getPlacesPaging(false, url, temp.paging.cursors.after);
        } else {
          return results;
        }
      })
    }

    return getPlacesPaging(true, url, "");
  }

  return new Promise(function (resolve, reject) {

    if (!self.latitude || !self.longitude) {
      var error = {
        "message": "Please specify the lat and lng parameters!",
        "code": 1
      };
      console.error(JSON.stringify(error));
      reject(error);
    } else if (!self.accessToken) {
      var error = {
        "message": "Please specify an Access Token, either as environment variable or as accessToken parameter!",
        "code": 2
      };
      console.error(JSON.stringify(error));
      reject(error);
    }

    var idLimit = 50, //FB only allows 50 ids per /?ids= call
      allEvents = [],
      places = [],
      currentTimestamp = (new Date().getTime() / 1000).toFixed(),
      venuesWithEvents = 0,
      eventsCount = 0,
      placeUrl = "https://graph.facebook.com/" + self.version + "/search" +
        "?type=place" +
        "&q=" + self.query +
        "&center=" + self.latitude + "," + self.longitude +
        "&distance=" + self.distance +
        "&limit=500" +
        "&categories=['ARTS_ENTERTAINMENT','FOOD_BEVERAGE']" +
        "&fields=" + fields.join(",") +
        "&access_token=" + self.accessToken;

    //Get places as specified
    getPlaces(placeUrl).then(function (responseBody) {
      console.log("Unfiltered Places found: " + responseBody.data.length);
      var ids = [],
        tempArray = [];

      places = responseBody.data;
      // resolve({
      //   locations: places,
      // });

      //Create array of 50 places each
      places.forEach(function (idObj, index, arr) {
        idObj.events = [];
        tempArray.push(idObj.id);
        if (tempArray.length >= idLimit) {
          ids.push(tempArray);
          tempArray = [];
        }
      });
      // Push the remaining places
      if (tempArray.length > 0) {
        ids.push(tempArray);
      }
      console.log(ids);
      return ids;
    }).then(function (ids) {
      var urls = [];
      //Create a Graph API request array (promisified)
      ids.forEach(function (idArray, index, arr) {
        var eventsFields = [
          "id",
          "type",
          "name",
          "cover.fields(id,source)",
          "picture.type(large)",
          "description",
          "start_time",
          "end_time",
          "category",
          "attending_count",
          "declined_count",
          "maybe_count",
          "noreply_count",
          "is_page_owned",
          "owner"
        ];
        var fields = [
          "id",
          "name",
          "about",
          "emails",
          "cover.fields(id,source)",
          "picture.type(large)",
          "category",
          "category_list.fields(name)",
          "location",
          "events.fields(" + eventsFields.join(",") + ")"
        ];
        var eventsUrl = "https://graph.facebook.com/" + self.version + "/" +
          "?ids=" + idArray.join(",") +
          "&access_token=" + self.accessToken +
          "&fields=" + fields.join(",") +
          ".since(" + self.since + ")";
        if (self.until) {
          eventsUrl += ".until(" + self.until + ")";
        }
        urls.push(rp.get(eventsUrl));
      });

      return urls;

    }).then(function (promisifiedRequests) {
      //Run Graph API requests in parallel
      return Promise.all(promisifiedRequests)
    }).then(function (results) {
      var events = [];
      //Handle results
      results.forEach(function (resStr, index, arr) {
        var resObj = JSON.parse(resStr);
        Object.getOwnPropertyNames(resObj).forEach(function (venueId, index, array) {
          var venue = resObj[venueId];
          if (venue.events && venue.events.data.length > 0) {
            venuesWithEvents++;
            venue.events.data.forEach(function (event, index, array) {
              var eventResultObj = {};
              var categoryList = null;
              if (venue.category_list && Array.isArray(venue.category_list)) {
                categoryList = [];
                venue.category_list.forEach(function (categoryObj) {
                  if (categoryObj.name) {
                    categoryList.push(categoryObj.name);
                  }
                });
              }
              eventResultObj.id = event.id;
              eventResultObj.name = event.name;
              eventResultObj.type = event.type;
              // eventResultObj.coverPicture = (event.cover ? event.cover.source : null);
              // eventResultObj.profilePicture = (event.picture ? event.picture.data.url : null);
              eventResultObj.description = (event.description ? event.description : null);
              // eventResultObj.distance = (venue.location ? (self.haversineDistance([venue.location.latitude, venue.location.longitude], [queryOptions.latitude, queryOptions.longitude], false) * 1000).toFixed() : null);
              eventResultObj.startTime = (event.start_time ? event.start_time : null);
              eventResultObj.endTime = (event.end_time ? event.end_time : null);
              // eventResultObj.timeFromNow = self.calculateStarttimeDifference(currentTimestamp, event.start_time);
              eventResultObj.category = (event.category ? event.category : null);
              // if (event.ticketing_terms_uri || event.ticketing_privacy_uri || event.ticket_uri) {
              //   eventResultObj.ticketing = {};
              //   if (event.ticket_uri) eventResultObj.ticketing.ticket_uri = event.ticket_uri;
              //   if (event.ticketing_terms_uri) eventResultObj.ticketing.terms_uri = event.ticketing_terms_uri;
              //   if (event.ticketing_privacy_uri) eventResultObj.ticketing.privacy_uri = event.ticketing_privacy_uri;
              // }
              eventResultObj.stats = {
                attending: event.attending_count,
                declined: event.declined_count,
                maybe: event.maybe_count,
                noreply: event.noreply_count
              };
              eventResultObj.venue = {};
              eventResultObj.venue.id = venueId;
              eventResultObj.venue.name = venue.name;
              eventResultObj.venue.about = (venue.about ? venue.about : null);
              eventResultObj.venue.emails = (venue.emails ? venue.emails : null);
              eventResultObj.venue.coverPicture = (venue.cover ? venue.cover.source : null);
              eventResultObj.venue.profilePicture = (venue.picture ? venue.picture.data.url : null);
              eventResultObj.venue.category = (venue.category ? venue.category : null);
              eventResultObj.venue.categoryList = categoryList;
              eventResultObj.venue.location = (venue.location ? venue.location : null);

              places.forEach(function (obj, index, arr) {
                if (eventResultObj.venue.id == obj.id) {
                  obj.events.push(eventResultObj);
                }

              });

              events.push(eventResultObj);
              eventsCount++;
            });
          }
        });
      });

      //Sort if requested
      // if (queryOptions.sort) {
      //   switch (queryOptions.sort) {
      //     case "time":
      //       events.sort(self.compareTimeFromNow);
      //       break;
      //     case "distance":
      //       events.sort(self.compareDistance);
      //       break;
      //     case "venue":
      //       events.sort(self.compareVenue);
      //       break;
      //     case "popularity":
      //       events.sort(self.comparePopularity);
      //       break;
      //     default:
      //       break;
      //   }
      // }

      resolve({
        // events: events,
        locations: places
      });
    }).catch(function (e) {
      var error = {
        "message": e,
        "code": -1
      };
      console.error(JSON.stringify(error));
      reject(error);
    });

  });

};

LocationSearch.prototype.getSchema = function () {
  return this.schema;
};

module.exports = LocationSearch;
