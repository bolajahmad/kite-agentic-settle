const binding = require('./binding')

exports.getHeapStatistics = function getHeapStatistics() {
  return binding.heapStatistics()
}

exports.getHeapSpaceStatistics = function getHeapSpaceStatistics() {
  return binding.heapSpaceStatistics()
}
