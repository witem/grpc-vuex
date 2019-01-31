import path from 'path'
import Promise from 'bluebird'
import _ from 'lodash'
import webpack from 'webpack'

import {
  outputFilePath,
  protoFilePaths,
  endpoint,
} from './command'
import {
  readFile,
  writeFile,
  copyFile,
  makeDir,
  removeDir,
  getProtocDependencies,
} from './file'
import {
  toJSON,
  getServices,
  getMessages,
  getModels,
  getMutationTypes,
  getActions,
} from './protobuf'
import {
  generateFileByProtoc,
  generateFileByProtocDependencies,
  generateCode,
  generateDtsCode,
} from './generator'

import caseJsCode from 'raw-loader!./case'
import grpcJsCode from 'raw-loader!./grpc'
import requestJsCode from 'raw-loader!./request'
import typeJsCode from 'raw-loader!./type'

const dirPath = '.grpc-vuex'
const tempFilePath = path.resolve(dirPath, 'index.js')
makeDir('.grpc-vuex')
  .then(()=>Promise.all([
    Promise
      .all([
        Promise.map(protoFilePaths, (p)=>readFile(p).then(toJSON)),
        Promise.map(protoFilePaths, generateFileByProtoc),
        Promise.map(protoFilePaths, (p)=>getProtocDependencies(p))
          .then(_.compact)
          .then((list)=>Promise.map(list, (p)=>generateFileByProtocDependencies(p))),
      ])
      .then(([ jsons ])=>{
        const params = jsons.map((json, i)=>{
          const protoName = path.basename(protoFilePaths[i], '.proto')
          const services = getServices(json)
          const messages = getMessages(json)
          const models = getModels(messages)
          const mutationTypes = getMutationTypes(services)
          const actions = getActions(services, protoName)
          return {
            mutationTypes,
            actions,
            models,
            messages,
          }
        })
        const code = generateCode(params, endpoint)
        const dtsCode = generateDtsCode(params)
        return Promise.all([
          writeFile(tempFilePath, code),
          writeFile(
            path.resolve(
              path.dirname(outputFilePath),
              path.basename(outputFilePath, '.js') + '.d.ts'
            ),
            dtsCode
          ),
        ])
      }),
    Promise.map([
      ['case.js', caseJsCode],
      ['grpc.js', grpcJsCode],
      ['request.js', requestJsCode],
      ['type.js', typeJsCode],
    ], ([ srcPath, code ])=>writeFile(path.resolve(dirPath, srcPath), code)),
  ]))
  .then(()=>{
    return new Promise((resolve, reject)=>{
      webpack({
        entry: tempFilePath,
        output: {
          filename: path.basename(outputFilePath),
          path: path.resolve(path.dirname(outputFilePath)),
          libraryTarget: 'commonjs',
        },
        mode: 'development',
        target: 'node',
      }, (err, stats)=>{
        if (err) {
          return reject(err)
        } else if (stats.hasErrors()) {
          return reject(stats)
        }
        return resolve()
      })
    })
  })
  .then(()=>removeDir(dirPath))
  .catch((err)=>console.error(err))
  