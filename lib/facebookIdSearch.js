"use strict";

var Promise = require("bluebird");
var rp = require("request-promise");
var path = require("path");
var fs = require("fs");


var fields = [
    "id",
    // "checkins",
    //  "engagement",
    "name",
    "location",
    // "description",
    "category_list",
];

var FacebookIdSearch = function (options) {

    var self = this,
        allowedSorts = ["time", "distance", "venue", "popularity"];

    self.name = options.name || null;
    self.address = options.address || null;
    self.accessToken = options.accessToken ? options.accessToken : (process.env.FEBL_ACCESS_TOKEN && process.env.FEBL_ACCESS_TOKEN !== "" ? process.env.FEBL_ACCESS_TOKEN : null);
    self.sort = options.sort ? (allowedSorts.indexOf(options.sort.toLowerCase()) > -1 ? options.sort.toLowerCase() : null) : null;
    self.version = options.version ? options.version : "v2.10";

};


FacebookIdSearch.prototype.search = function () {
    var self = this;
    return new Promise(function (resolve, reject) {

        if (!self.name || !self.address) {
            var error = {
                "message": "Please specify the name or address!",
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
            currentTimestamp = (new Date().getTime() / 1000).toFixed();

        var url = "https://graph.facebook.com/" + self.version + "/" +
            "search?q=" + self.name + " " + self.address +
            "&type=page" +
            "&fields=" + fields.join(",") +
            "&access_token=" + self.accessToken;

        rp.get(url).then(function (response) {
            response = JSON.parse(response);
            //Create a Graph API request array (promisified)
            response.data.forEach(function (idArray, index, arr) {
                var street = idArray.location.street.toUpperCase();
                console.log(street);
                console.log(self.address.toUpperCase());
                if (idArray.location !== undefined  && street.indexOf(self.address.toUpperCase()) !== -1) {
                    resolve({
                        id: idArray
                    });
                }
            });
            resolve({
                message: "No Facebook page found!"
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


module.exports = FacebookIdSearch;
