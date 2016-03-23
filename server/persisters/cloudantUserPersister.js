const cfenv = require('cfenv');
const Cloudant = require('cloudant');
const log4js = require('log4js');
const logger = log4js.getLogger("CloudantUserPersister");
const Q = require('q');
const User = require('./../models/UserModel');

const ERROR = {
	USERNAME_NOT_FOUND: "Username not found",
	CANT_READ_CREDENTIALS: "Can't read Cloudant credentials",
	ENSURE_ENV_VARS_SET: "Ensure that following environment variables are set ::",
	FAILED_CONNECTING: "There was a database connectivity error. Please retry again later."
}

function CloudantUserPersister(){

	const CLOUDANT_ACCOUNT = "CLOUDANT_ACCOUNT";
	const CLOUDANT_API_KEY = "CLOUDANT_API_KEY";
	const CLOUDANT_API_PASSWORD = "CLOUDANT_API_PASSWORD";
	var usersdb;

	function init(){
		logger.info("Initializing");
		var deferred = Q.defer();

		var cloudantAccount = process.env[CLOUDANT_ACCOUNT];
		var cloudantApiKey = process.env[CLOUDANT_API_KEY];
		var cloudantApiPassword = process.env[CLOUDANT_API_PASSWORD];

		if (cloudantAccount == null || cloudantApiKey == null || cloudantApiPassword == null){
			logger.fatal(ERROR.CANT_READ_CREDENTIALS, ERROR.ENSURE_ENV_VARS_SET, CLOUDANT_ACCOUNT, CLOUDANT_API_KEY, CLOUDANT_API_PASSWORD);
			return Q.reject(ERROR.CANT_READ_CREDENTIALS);
		}
		logger.info("Attempting to use Cloudant account ::", cloudantAccount);

		Cloudant({
			account:cloudantAccount,
			key: cloudantApiKey,
			password: cloudantApiPassword
		}, function(err, cloudant){
			if (err != null){
				logger.fatal(ERROR.FAILED_CONNECTING, err);
				return Q.reject(ERROR.FAILED_CONNECTING);
			}
			logger.info("Cloudant connection successfully established");
			usersdb = cloudant.db.use('users');
		});

		return deferred.promise;
	}

	function getAllUsers(){
		var deferred = Q.defer();
		usersdb.list({include_docs:true}, function(err, resp){
			if (err != null){
				logger.error(ERROR.FAILED_CONNECTING, err);
				return deferred.reject(ERROR.FAILED_CONNECTING);
			}
			var users = [];
			resp.rows.forEach(function(row){
				users.push(User.fromJSON(row.doc));
			});

			return deferred.resolve(users);

		});

		return deferred.promise;
	}

	function getUser(username){
		var deferred = Q.defer();
		usersdb.get(username, function(err, resp){
			if (err != null){
				if (err.statusCode == 404) {
					logger.error(ERROR.USERNAME_NOT_FOUND, username);
					return deferred.reject(ERROR.USERNAME_NOT_FOUND);
				} else {
					logger.error(ERROR.FAILED_CONNECTING, err);
					return deferred.reject(ERROR.FAILED_CONNECTING);
				}
			}

			return deferred.resolve(User.fromJSON(resp));
		});

		return deferred.promise;
	}

	function postUser(newUser){
		var deferred = Q.defer();

		getLatestDocRevision(newUser.username).then(function(rev){
			if (rev == null){
				// insert
				usersdb.insert(newUser.toJSON(), newUser.username, function(err, resp){
					if (err != null){
						logger.error(ERROR.FAILED_CONNECTING, err);
						return deferred.reject(ERROR.FAILED_CONNECTING);
					}

					return deferred.resolve();

				});
			} else {
				//update
				var json = newUser.toJSON();
				json["_id"] = newUser.username;
				json["_rev"] = rev;
				usersdb.insert(json, function(err, resp) {
					if (err != null) {
						logger.error(ERROR.FAILED_CONNECTING, err);
						return deferred.reject(ERROR.FAILED_CONNECTING);
					}

					return deferred.resolve();
				});
			}

		}).catch(function(err){
			logger.error(err);
			deferred.reject(err)
		});

		return deferred.promise;

	}

	function deleteUser(username){
		var deferred = Q.defer();

		getLatestDocRevision(username).then(function(rev){
			if (rev == null){
				return deferred.reject(ERROR.USERNAME_NOT_FOUND);
			}

			usersdb.destroy(username, rev, function(err, resp){
				if (err != null){
					logger.error(ERROR.FAILED_CONNECTING, err);
					return deferred.reject(ERROR.FAILED_CONNECTING);
				}
				return deferred.resolve();
			});
		}).catch(function(err){
			logger.error(err);
			return deferred.reject(err);
		});

		return deferred.promise;
	}

	function getLatestDocRevision(docId){
		var deferred = Q.defer();
		usersdb.get(docId, function(err, resp){
			if (err != null){
				if (err.statusCode == 404) {
					logger.warn(ERROR.USERNAME_NOT_FOUND);
					return deferred.resolve(null);
				} else {
					logger.error(ERROR.FAILED_CONNECTING, err);
					return deferred.reject(ERROR.FAILED_CONNECTING);
				}
			}

			return deferred.resolve(resp["_rev"]);
		});



		return deferred.promise;
	}

	return {
		init:init,
		getAllUsers:getAllUsers,
		getUser:getUser,
		postUser:postUser,
		deleteUser:deleteUser
	}

}
module.exports = new CloudantUserPersister();
