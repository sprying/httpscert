#!/usr/bin/env node
const { program } = require('commander')
const pkg = require('./package.json')
const { install, uninstall, info, doTrust, addHosts, certificateFor } = require('./index')

program
  .name('httpscert')
  .usage('[global option] | [command]')
  // .usage('command')
  .version(pkg.version, '-v, --version', '当前版本')

program.on('--help', () => {
  // console.log('')
  // console.log('先安装，再使用其它命令')
  // console.log('  $ httpscert install')
})

program
  .command('install')
  .description('生成ssl密钥和自签名证书，在系统钥匙串里添加和信任自签名证书')
  .action(() => {
    install()
  })

program
  .command('info', { isDefault: true })
  .description('查看自签名信息')
  .action(() => {
    info()
  })

program
  .command('trust')
  .description('信任自签名证书')
  .action(() => {
    doTrust()
  })

program
  .command('add <host>')
  .description('添加要支持的域名，支持以,分隔')
  .action((hosts) => {
    addHosts(hosts.split(',').map(host => host))
  })

program
  .command('uninstall')
  .description('删除生成的ssl密钥和自签名证书')
  .action(() => {
    uninstall()
  })

program
  .command('api', { noHelp: true })
  .description('调用api的示例')
  .action(() => {
    certificateFor(['*.fa']).then(res => {
      console.log(res)
    })
  })

program.parse(process.argv)
